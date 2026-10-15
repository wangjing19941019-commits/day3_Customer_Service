在公共字段之外，按物流异常工单抽取。不要把用户单方面的丢件说法写成已核实事实；intent_summary 用「用户称……」记录用户的说法，例如「用户称快递丢失，未收到货」。

exception_type 只能是 delay、lost、damaged、wrong_or_missing、refused、address_exception 之一。

responsible_party 与 compensation_plan 必须输出 null，不要按用户说法填写责任方，也不要承诺赔付。

输出 JSON 必须且仅可包含这些键：
{
  "order_no": {"value": null, "confidence": "high"},
  "product_info": {"value": null, "confidence": "high"},
  "amount": {"value": null, "confidence": "high"},
  "intent_summary": {"value": null, "confidence": "high"},
  "tracking_no": {"value": null, "confidence": "high"},
  "exception_type": {"value": null, "confidence": "high"},
  "responsible_party": {"value": null, "confidence": "high"},
  "user_request": {"value": null, "confidence": "high"},
  "compensation_plan": {"value": null, "confidence": "high"},
  "time_range_text": null,
  "keywords": []
}
