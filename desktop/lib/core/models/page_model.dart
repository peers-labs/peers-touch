class PageModel<T> {
  final List<T> list;
  final int page;
  final int size;
  final int total;

  PageModel({required this.list, required this.page, required this.size, required this.total});
}