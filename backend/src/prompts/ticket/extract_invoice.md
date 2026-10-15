在公共字段之外，按开发票工单抽取。没有税号则 tax_id 必须为 null，禁止编造纳税人识别号。专用发票才填税号。

invoice_kind 只能是 plain 或 vat_special，无法确定则为 null。

输出 JSON 必须且仅可包含这些键：
{
  "order_no": {"value": null, "confidence": "high"},
  "product_info": {"value": null, "confidence": "high"},
  "amount": {"value": null, "confidence": "high"},
  "intent_summary": {"value": null, "confidence": "high"},
  "invoice_kind": {"value": null, "confidence": "high"},
  "invoice_title": {"value": null, "confidence": "high"},
  "tax_id": {"value": null, "confidence": "high"},
  "invoice_contact": {"value": null, "confidence": "high"},
  "time_range_text": null,
  "keywords": []
}
