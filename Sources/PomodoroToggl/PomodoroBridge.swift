import WebKit

final class PomodoroBridge: NSObject, WKScriptMessageHandler {
  let deskReminder: DeskReminderController
  weak var webView: WKWebView?

  init(deskReminder: DeskReminderController) {
    self.deskReminder = deskReminder
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == "pomodoro" else { return }
    guard let body = Self.jsDictionary(from: message.body) else { return }
    guard let type = Self.stringValue(body["type"]) else { return }

    switch type {
    case "phase":
      let phase = Self.stringValue(body["phase"]) ?? "idle"
      let connected = Self.boolValue(body["connected"])
      deskReminder.updatePhase(phase: phase, connected: connected)

    case "loginItem":
      guard let action = Self.stringValue(body["action"]) else {
        replyLoginItemError("Missing loginItem action")
        return
      }
      if action == "get" {
        replyLoginItemPayload()
      } else if action == "set" {
        guard let enabled = Self.boolValueOpt(body["enabled"]) else {
          replyLoginItemError("Missing or invalid “enabled” for loginItem set")
          return
        }
        do {
          try LoginItemManager.setLoginItemEnabled(enabled)
          replyLoginItemPayload()
        } catch {
          replyLoginItemPayload(error: error.localizedDescription)
        }
      } else {
        replyLoginItemError("Unknown loginItem action: \(action)")
      }

    case "deskReminder":
      guard let action = Self.stringValue(body["action"]) else {
        replyDeskReminderError("Missing deskReminder action")
        return
      }
      if action == "get" {
        replyDeskReminderPayload()
      } else if action == "set" {
        guard let enabled = Self.boolValueOpt(body["enabled"]) else {
          replyDeskReminderError("Missing or invalid “enabled” for deskReminder set")
          return
        }
        guard let rawMinutes = Self.intValueOpt(body["thresholdMinutes"]) else {
          replyDeskReminderError("Missing or invalid “thresholdMinutes” for deskReminder set")
          return
        }
        let clamped = min(240, max(1, rawMinutes))
        let seconds = Double(clamped) * 60
        deskReminder.applyConfiguration(enabled: enabled, targetSeconds: seconds)
        replyDeskReminderPayload()
      } else {
        replyDeskReminderError("Unknown deskReminder action: \(action)")
      }

    default:
      break
    }
  }

  private func replyLoginItemError(_ message: String) {
    replyLoginItemPayload(error: message)
  }

  private func replyLoginItemPayload(error: String? = nil) {
    var detail: [String: Any] = [
      "enabled": LoginItemManager.loginItemOn,
      "requiresApproval": LoginItemManager.requiresApproval,
      "supported": LoginItemManager.loginItemsSupported,
    ]
    if let error {
      detail["error"] = error
    }
    replyLoginItemDetail(detail)
  }

  private func replyLoginItemDetail(_ detail: [String: Any]) {
    let json: String
    if let data = try? JSONSerialization.data(withJSONObject: detail),
      let s = String(data: data, encoding: .utf8)
    {
      json = s
    } else {
      let en = Self.boolValue(detail["enabled"])
      let ra = Self.boolValue(detail["requiresApproval"])
      let sup = Self.boolValue(detail["supported"])
      let err = Self.stringValue(detail["error"]).map { Self.jsonEscape($0) } ?? ""
      if err.isEmpty {
        json = "{\"enabled\":\(en),\"requiresApproval\":\(ra),\"supported\":\(sup)}"
      } else {
        json =
          "{\"enabled\":\(en),\"requiresApproval\":\(ra),\"supported\":\(sup),\"error\":\"\(err)\"}"
      }
    }
    let js =
      "window.dispatchEvent(new CustomEvent('pomodoro-login-item', { detail: \(json) }));"
    let run: () -> Void = { [weak self] in
      self?.webView?.evaluateJavaScript(js) { _, error in
        if let error {
          NSLog("PomodoroBridge evaluateJavaScript: \(error.localizedDescription)")
        }
      }
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async(execute: run)
    }
  }

  private func replyDeskReminderError(_ message: String) {
    replyDeskReminderPayload(error: message)
  }

  private func replyDeskReminderPayload(error: String? = nil) {
    let snap = deskReminder.currentConfiguration()
    var detail: [String: Any] = [
      "enabled": snap.enabled,
      "thresholdMinutes": snap.thresholdMinutes,
    ]
    if let error {
      detail["error"] = error
    }
    replyDeskReminderDetail(detail)
  }

  private func replyDeskReminderDetail(_ detail: [String: Any]) {
    let json: String
    if let data = try? JSONSerialization.data(withJSONObject: detail),
      let s = String(data: data, encoding: .utf8)
    {
      json = s
    } else {
      let en = Self.boolValue(detail["enabled"])
      let tm = Self.intValue(detail["thresholdMinutes"]) ?? 10
      let err = Self.stringValue(detail["error"]).map { Self.jsonEscape($0) } ?? ""
      if err.isEmpty {
        json = "{\"enabled\":\(en),\"thresholdMinutes\":\(tm)}"
      } else {
        json = "{\"enabled\":\(en),\"thresholdMinutes\":\(tm),\"error\":\"\(err)\"}"
      }
    }
    let js =
      "window.dispatchEvent(new CustomEvent('pomodoro-desk-reminder', { detail: \(json) }));"
    let run: () -> Void = { [weak self] in
      self?.webView?.evaluateJavaScript(js) { _, error in
        if let error {
          NSLog("PomodoroBridge evaluateJavaScript: \(error.localizedDescription)")
        }
      }
    }
    if Thread.isMainThread {
      run()
    } else {
      DispatchQueue.main.async(execute: run)
    }
  }

  private static func jsonEscape(_ s: String) -> String {
    s
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
      .replacingOccurrences(of: "\n", with: "\\n")
  }

  /// WKWebView often delivers `body` as `NSDictionary`, not `[String: Any]`.
  private static func jsDictionary(from body: Any) -> [String: Any]? {
    if let d = body as? [String: Any] {
      return d
    }
    guard let n = body as? NSDictionary else { return nil }
    var out: [String: Any] = [:]
    n.enumerateKeysAndObjects { key, value, _ in
      guard let ks = key as? String else { return }
      out[ks] = value
    }
    return out
  }

  private static func stringValue(_ v: Any?) -> String? {
    if let s = v as? String { return s }
    if let s = v as? NSString { return s as String }
    return nil
  }

  private static func boolValue(_ v: Any?) -> Bool {
    if let b = v as? Bool { return b }
    if let n = v as? NSNumber { return n.boolValue }
    return false
  }

  private static func boolValueOpt(_ v: Any?) -> Bool? {
    if v == nil { return nil }
    if let b = v as? Bool { return b }
    if let n = v as? NSNumber { return n.boolValue }
    return nil
  }

  private static func intValueOpt(_ v: Any?) -> Int? {
    if let i = v as? Int { return i }
    if let n = v as? NSNumber { return n.intValue }
    return nil
  }

  private static func intValue(_ v: Any?) -> Int? {
    intValueOpt(v)
  }
}
