class ActorBase {
  final String id;
  final String name;
  final String? avatar;

  ActorBase({required this.id, required this.name, this.avatar});

  factory ActorBase.fromJson(Map<String, dynamic> json) => ActorBase(
        id: (json['id']?.toString()) ?? '',
        name: (json['name'] as String?) ?? '',
        avatar: json['avatar'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'avatar': avatar,
      };
}