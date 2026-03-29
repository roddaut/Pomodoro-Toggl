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
      let err = Self.stringValue(detail["error"]).map { Self.jsonEscape($0) } ?? ""
      if err.isEmpty {
        json = "{\"enabled\":\(en),\"requiresApproval\":\(ra)}"
      } else {
        json = "{\"enabled\":\(en),\"requiresApproval\":\(ra),\"error\":\"\(err)\"}"
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
}
