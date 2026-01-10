class UploadResult {
  UploadResult({required this.remoteUrl, this.localPath, this.mime, this.key});
  final String remoteUrl;
  final String? localPath;
  final String? mime;
  final String? key;
}
