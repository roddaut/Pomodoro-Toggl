// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "PomodoroToggl",
  platforms: [
    .macOS(.v13)
  ],
  targets: [
    .executableTarget(
      name: "PomodoroToggl",
      path: "Sources/PomodoroToggl",
      resources: [
        .copy("Resources/dist")
      ]
    )
  ]
)
