import Foundation
import Vision

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US", "zh-Hans"]
try VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1])).perform([request])
let lines = request.results?.compactMap { $0.topCandidates(1).first?.string } ?? []
let data = try JSONSerialization.data(withJSONObject: lines)
print(String(data: data, encoding: .utf8)!)
