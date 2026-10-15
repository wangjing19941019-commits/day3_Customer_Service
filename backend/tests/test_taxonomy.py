from __future__ import annotations

import json
from pathlib import Path

from src.services.ingest import _parse_tag_faq, taxonomy_codes
from src.services.qa import parse_classification

_PROJECT = Path(__file__).resolve().parents[2]
_DOCS_TAXONOMY = _PROJECT / "docs" / "tag-taxonomy.json"
_BACKEND_TAXONOMY = _PROJECT / "backend" / "src" / "resources" / "tag-taxonomy.json"
_INGEST_PROMPT = _PROJECT / "backend" / "src" / "prompts" / "ingest_tag_faq.md"
_REWRITE_PROMPT = _PROJECT / "backend" / "src" / "prompts" / "rewrite_classify.md"
_SMALL_TALK_PROMPT = _PROJECT / "backend" / "src" / "prompts" / "small_talk.md"
_ANSWER_PROMPT = _PROJECT / "backend" / "src" / "prompts" / "answer.md"
_V1_OBJECTS = {"hardware", "software", "account", "network", "resource"}
_V1_REQUESTS = {"maintenance", "resource_request", "permission_request"}
_V2_OBJECTS = {
    "product_3c",
    "product_fashion",
    "order_logistics",
    "return_exchange",
    "address_change",
    "invoice",
    "complaint",
}
_V2_REQUESTS = {
    "pre_sale_consult",
    "usage_guidance",
    "policy_process",
    "after_sale_howto",
    "troubleshooting",
}
_RULE_PHRASES = (
    "不用商品名直接决定诉求",
    "不把现象当成原因",
    "3C 与服饰美妆口径不得混用",
    "不查询实时订单/物流/库存/支付",
    "不创建或确认工单",
    "policy_process",
    "after_sale_howto",
)


def test_backend_taxonomy_is_v2_and_same_as_docs() -> None:
    docs = json.loads(_DOCS_TAXONOMY.read_text(encoding="utf-8"))
    backend = json.loads(_BACKEND_TAXONOMY.read_text(encoding="utf-8"))
    assert docs == backend
    assert backend["version"] == "2.0"
    object_codes = {item["code"] for item in backend["object_types"]}
    request_codes = {item["code"] for item in backend["request_types"]}
    assert object_codes == _V2_OBJECTS
    assert request_codes == _V2_REQUESTS
    assert object_codes.isdisjoint(_V1_OBJECTS)
    assert request_codes.isdisjoint(_V1_REQUESTS)


def test_prompts_write_v2_classification_rules() -> None:
    ingest = _INGEST_PROMPT.read_text(encoding="utf-8")
    rewrite = _REWRITE_PROMPT.read_text(encoding="utf-8")
    small_talk = _SMALL_TALK_PROMPT.read_text(encoding="utf-8")
    answer = _ANSWER_PROMPT.read_text(encoding="utf-8")
    for phrase in _RULE_PHRASES:
        assert phrase in ingest
        assert phrase in rewrite
    assert "你是企业内部 IT" not in ingest
    assert "你是企业内部 IT" not in rewrite
    assert "你是企业内部 IT" not in small_talk
    assert "你是企业内部 IT" not in answer
    assert "不承诺查询实时订单" in small_talk
    assert "不创建或确认工单" in small_talk
    assert "3C 与服饰美妆口径不得混用" in answer
    assert "不查询实时订单/物流/库存/支付" in answer


def test_ingest_drops_illegal_v1_codes() -> None:
    object_codes, request_codes = taxonomy_codes()
    parsed = _parse_tag_faq(
        json.dumps(
            {
                "object_types": ["hardware", "product_3c", "product_fashion"],
                "request_types": ["maintenance", "policy_process"],
                "entities": [
                    {"name": "显示器", "type": "device"},
                    {"name": "共享盘", "type": "resource"},
                    {"name": "iPhone 15", "type": "product"},
                    {"name": "ORD-88", "type": "order"},
                    {"name": "256GB", "type": "spec"},
                ],
                "faqs": [],
            },
            ensure_ascii=False,
        ),
        object_codes,
        request_codes,
    )
    assert parsed["object_types"] == ["product_3c", "product_fashion"]
    assert parsed["request_types"] == ["policy_process"]
    assert parsed["entities"] == [
        {"name": "iPhone 15", "type": "product"},
        {"name": "ORD-88", "type": "order"},
        {"name": "256GB", "type": "spec"},
    ]


def test_parse_classification_drops_illegal_v1_codes() -> None:
    object_codes, request_codes = taxonomy_codes()
    raw = json.dumps(
        {
            "rewritten_query": "显示器怎么报修",
            "query_output": {
                "message_type": "service_request",
                "issues": [
                    {
                        "issue_id": "1",
                        "summary": "报修显示器",
                        "primary_object_type": "hardware",
                        "related_object_types": ["software", "product_3c"],
                        "request_type": "maintenance",
                        "entities": [
                            {"name": "显示器", "type": "device"},
                            {"name": "iPhone 15", "type": "product"},
                        ],
                        "symptom": None,
                        "error_message": None,
                        "processing_status": "ready",
                        "retrieval_query": "显示器怎么报修",
                        "missing_information": [],
                        "clarification_question": None,
                    }
                ],
            },
        },
        ensure_ascii=False,
    )
    result = parse_classification(raw, object_codes, request_codes)
    issue = result.issues[0]
    assert issue.primary_object_type is None
    assert issue.related_object_types == ["product_3c"]
    assert issue.request_type is None
    assert issue.entities == [{"name": "iPhone 15", "type": "product"}]
