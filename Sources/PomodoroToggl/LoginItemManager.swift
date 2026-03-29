import Foundation
import ServiceManagement

/// Registers this app as a login item via `SMAppService` (macOS 13+).
enum LoginItemManager {
  private static var service: SMAppService { SMAppService.mainApp }

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
    if enabled {
      try service.register()
    } else {
      try service.unregister()
    }
  }
}
