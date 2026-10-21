import Foundation
import ServiceManagement

/// Registers this app as a login item via `SMAppService` (macOS 13+).
enum LoginItemManager {
  private static var service: SMAppService { SMAppService.mainApp }

  /// `SMAppService.mainApp` only works when the process runs inside a `.app` bundle (not a bare SwiftPM binary).
  static var loginItemsSupported: Bool {
    Bundle.main.bundlePath.hasSuffix(".app")
  }

  /// Whether the login item is active (macOS will launch this app at login).
  static var isRegistered: Bool {
    service.status == .enabled
  }

  /// User enabled the login item in-app but must approve in System Settings → Login Items.
  static var requiresApproval: Bool {
    service.status == .requiresApproval
  }

  /// Reflects user intent: on when enabled, or when approval is still pending.
  static var loginItemOn: Bool {
    isRegistered || requiresApproval
  }

  static func setLoginItemEnabled(_ enabled: Bool) throws {
    guard loginItemsSupported else {
      throw NSError(
        domain: "PomodoroToggl",
        code: 1,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Open at login only works when you run PomodoroToggl.app (not the command-line binary)."
        ]
      )
    }
    if enabled {
      try service.register()
    } else {
      try service.unregister()
    }
  }
}
