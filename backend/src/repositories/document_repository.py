from datetime import UTC, datetime

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.db.models import Chunk, Document, Faq

REUPLOAD_MESSAGE = "请重新上传"
DEFAULT_READY_VISIBILITY = "user_visible"


class DocumentRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def ensure_columns(self) -> None:
        result = await self.db.execute(text("PRAGMA table_info(documents)"))
        cols = {row[1] for row in result.fetchall()}
        if "visibility" not in cols:
            await self.db.execute(text("ALTER TABLE documents ADD COLUMN visibility VARCHAR(32)"))
        if "effective_from" not in cols:
            await self.db.execute(text("ALTER TABLE documents ADD COLUMN effective_from DATETIME"))
        if "effective_to" not in cols:
            await self.db.execute(text("ALTER TABLE documents ADD COLUMN effective_to DATETIME"))

    async def create_ingesting(self, document_id: str, filename: str) -> Document:
        await self.ensure_columns()
        document = Document(
            id=document_id,
            filename=filename,
            ingest_status="ingesting",
            ingest_error=None,
            object_types_json=[],
            request_types_json=[],
            entities_json=[],
            visibility=None,
            effective_from=None,
            effective_to=None,
        )
        self.db.add(document)
        await self.db.flush()
        await self.db.refresh(document)
        return document

    async def get(self, document_id: str) -> Document | None:
        await self.ensure_columns()
        result = await self.db.execute(
            select(Document)
            .where(Document.id == document_id)
            .options(selectinload(Document.chunks), selectinload(Document.faqs))
        )
        return result.scalar_one_or_none()

    async def list_page(
        self,
        offset: int,
        limit: int,
        ingest_status: str | None = None,
    ) -> tuple[list[Document], int]:
        await self.ensure_columns()
        filters = []
        if ingest_status is not None:
            filters.append(Document.ingest_status == ingest_status)
        total = await self.db.scalar(
            select(func.count()).select_from(Document).where(*filters)
        )
        result = await self.db.execute(
            select(Document)
            .where(*filters)
            .options(selectinload(Document.chunks), selectinload(Document.faqs))
            .order_by(Document.updated_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(result.scalars().all()), int(total or 0)

    async def delete_children(self, document_id: str) -> None:
        await self.db.execute(delete(Chunk).where(Chunk.document_id == document_id))
        await self.delete_faqs(document_id)

    async def delete_faqs(self, document_id: str) -> None:
        await self.db.execute(delete(Faq).where(Faq.document_id == document_id))

    async def delete_children_faqs_only(self, document_id: str) -> None:
        await self.delete_faqs(document_id)

    async def save_ready(
        self,
        document: Document,
        *,
        object_types: list[str],
        request_types: list[str],
        entities: list[dict],
        chunks: list[Chunk],
        faqs: list[Faq],
    ) -> Document:
        await self.delete_children(document.id)
        document.object_types_json = object_types
        document.request_types_json = request_types
        document.entities_json = entities
        document.ingest_status = "ready"
        document.ingest_error = None
        if not document.visibility:
            document.visibility = DEFAULT_READY_VISIBILITY
        document.updated_at = datetime.now(UTC)
        for chunk in chunks:
            self.db.add(chunk)
        for faq in faqs:
            self.db.add(faq)
        await self.db.flush()
        self.db.expire(document, ["chunks", "faqs", "updated_at"])
        return await self.get(document.id) or document

    async def mark_failed(self, document_id: str) -> Document | None:
        document = await self.get(document_id)
        if document is None:
            return None
        await self.delete_children(document_id)
        document.ingest_status = "failed"
        document.ingest_error = REUPLOAD_MESSAGE
        document.object_types_json = []
        document.request_types_json = []
        document.entities_json = []
        document.updated_at = datetime.now(UTC)
        await self.db.flush()
        await self.db.refresh(document)
        return document

    async def mark_stale(self, cutoff: datetime) -> int:
        cutoff_naive = cutoff.astimezone(UTC).replace(tzinfo=None) if cutoff.tzinfo else cutoff
        result = await self.db.execute(
            select(Document).where(Document.ingest_status == "ingesting")
        )
        documents = list(result.scalars().all())
        changed = 0
        for document in documents:
            updated = document.updated_at
            if updated.tzinfo is not None:
                updated = updated.astimezone(UTC).replace(tzinfo=None)
            if updated >= cutoff_naive:
                continue
            await self.delete_children(document.id)
            document.ingest_status = "failed"
            document.ingest_error = REUPLOAD_MESSAGE
            document.object_types_json = []
            document.request_types_json = []
            document.entities_json = []
            document.updated_at = datetime.now(UTC)
            changed += 1
        if changed:
            await self.db.flush()
        return changed
