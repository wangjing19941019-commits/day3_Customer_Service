在公共字段之外，按费用争议工单抽取。platform_amount 只能摘录会话里已出现的核算结果，禁止新编赔付或核算金额。

dispute_type 只能是 price_protect、shipping_fee、refund_amount 之一，无法确定则为 null。

不要抽取证据截图。不要承诺赔付。

输出 JSON 必须且仅可包含这些键：
{
  "order_no": {"value": null, "confidence": "high"},
  "product_info": {"value": null, "confidence": "high"},
  "amount": {"value": null, "confidence": "high"},
  "intent_summary": {"value": null, "confidence": "high"},
  "dispute_type": {"value": null, "confidence": "high"},
  "claimed_amount": {"value": null, "confidence": "high"},
  "platform_amount": {"value": null, "confidence": "high"},
  "diff_reason": {"value": null, "confidence": "high"},
  "time_range_text": null,
  "keywords": []
}
