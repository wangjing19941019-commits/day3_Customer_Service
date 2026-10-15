在公共字段之外，按修改地址工单抽取。会话中没有完整新地址时，new_address 必须为 null，禁止编造地址。

电话、原地址、新地址必须来自会话原文。

输出 JSON 必须且仅可包含这些键：
{
  "order_no": {"value": null, "confidence": "high"},
  "product_info": {"value": null, "confidence": "high"},
  "amount": {"value": null, "confidence": "high"},
  "intent_summary": {"value": null, "confidence": "high"},
  "original_address": {"value": null, "confidence": "high"},
  "new_address": {"value": null, "confidence": "high"},
  "recipient_name": {"value": null, "confidence": "high"},
  "phone": {"value": null, "confidence": "high"},
  "time_range_text": null,
  "keywords": []
}
