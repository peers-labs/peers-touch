class PageModel<T> {

  PageModel({required this.list, required this.page, required this.size, required this.total});
  final List<T> list;
  final int page;
  final int size;
  final int total;
}