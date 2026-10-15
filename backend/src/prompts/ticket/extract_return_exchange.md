在公共字段之外，按退换货工单抽取。不要编造售后方式、原因或数量。

return_method 只能是 return_only、exchange、refund_only 之一，无法确定则为 null。

输出 JSON 必须且仅可包含这些键：
{
  "order_no": {"value": null, "confidence": "high"},
  "product_info": {"value": null, "confidence": "high"},
  "amount": {"value": null, "confidence": "high"},
  "intent_summary": {"value": null, "confidence": "high"},
  "return_method": {"value": null, "confidence": "high"},
  "return_reason": {"value": null, "confidence": "high"},
  "quantity": {"value": null, "confidence": "high"},
  "time_range_text": null,
  "keywords": []
}
