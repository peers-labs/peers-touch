// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-peers-secure-input",
  defaultLocalization: "en",
  platforms: [
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-peers-secure-input",
      type: .static,
      targets: ["tauri-plugin-peers-secure-input"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-peers-secure-input",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources",
      resources: [.process("Resources")])
  ]
)
