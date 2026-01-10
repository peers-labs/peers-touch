# ADR-003: Social System Refactor - From ActivityPub to Modern Architecture

**Status:** In Progress  
**Date:** 2025-01-09  
**Decision Makers:** Project Team  
**Related:** [POST_TYPES.md](../../../model/domain/social/POST_TYPES.md), [REFACTOR_PLAN.md](../../../station/frame/touch/social/REFACTOR_PLAN.md)

---

## Context

### Problem Statement

The current social posting system is based on ActivityPub protocol, which has several issues:

1. **Over-complexity**: JSON-LD and Activity Streams 2.0 create unnecessary complexity
2. **Poor Performance**: Push-based federation model doesn't scale well
3. **Bad Developer Experience**: HTTP Signatures are difficult to debug
4. **Limited Features**: ActivityPub's design constraints limit modern social features

### Current State

- Using ActivityPub for federation (Mastodon-compatible)
- Complex data models with nested objects
- Performance bottlenecks in timeline generation
- Difficult to add new post types

### Goals

1. **Simplify Architecture**: Focus on single-node performance first
2. **Modern Post Types**: Support TEXT, IMAGE, VIDEO, LINK, POLL, REPOST, LOCATION
3. **Better Performance**: Optimize for read-heavy workloads
4. **Maintainability**: Clean separation of concerns, testable code
5. **Future-Ready**: Design allows federation later, but doesn't require it now

---

## Decision

### Architectural Approach

**Abandon ActivityPub for core social features, build modern REST API**

Key principles:
- **Proto-First**: All models defined in Protocol Buffers
- **Clean Architecture**: Repository → Service → Handler layers
- **Test-Driven**: Write tests before implementation
- **Performance-Oriented**: Cursor pagination, denormalized counters, caching-ready

### Technology Stack

**Backend (Station/Go):**
- Protocol Buffers for data models
- GORM for database access
- Gin for HTTP routing
- Structured logging (logger package)

**Frontend (Desktop/Dart):**
- GetX for state management
- Proto-generated Dart models
- HttpService for API calls
- StatelessWidget + GetxController pattern

### Data Model Design

**7 Post Types:**
1. TEXT - Pure text with hashtags and mentions
2. IMAGE - 1-9 images with text
3. VIDEO - Single video with text
4. LINK - URL with auto-preview
5. POLL - Voting with 2-4 options
6. REPOST - Quote repost with comment
7. LOCATION - Check-in with images

**Database Schema:**
- `posts` - Core post metadata
- `post_contents` - Type-specific content (JSON)
- `media` - Uploaded files
- `post_likes` - Like records
- `comments` - Comment tree
- `comment_likes` - Comment likes
- `follows` - Follow relationships
- `poll_votes` - Poll voting records

### API Design

RESTful endpoints:
```
POST   /api/v1/posts
GET    /api/v1/posts/:id
PUT    /api/v1/posts/:id
DELETE /api/v1/posts/:id
POST   /api/v1/posts/:id/like
DELETE /api/v1/posts/:id/like
GET    /api/v1/posts/:id/comments
POST   /api/v1/posts/:id/comments
GET    /api/v1/timelines/home
GET    /api/v1/timelines/user/:id
GET    /api/v1/timelines/public
POST   /api/v1/media
POST   /api/v1/posts/:id/vote
```

---

## Implementation Plan

### Phase 1: Foundation (2-3 hours)
- [x] Proto definitions created
- [x] Database models defined
- [ ] Generate Proto code (Go + Dart)
- [ ] Create database tables
- [ ] Verify compilation

### Phase 2: Backend (2-3 days)
- [ ] Repository layer + tests
- [ ] Service layer + tests
- [ ] Converter layer + tests
- [ ] Handler layer + tests
- [ ] Router registration

### Phase 3: Frontend (2-3 days)
- [ ] API Client
- [ ] Post Feature Module
- [ ] Timeline Feature Module
- [ ] UI Components

### Phase 4: Testing (1-2 days)
- [ ] Unit tests (>80% coverage)
- [ ] Integration tests
- [ ] E2E tests
- [ ] Performance tests

### Phase 5: Cleanup (1 day)
- [ ] Remove old ActivityPub code
- [ ] Update documentation
- [ ] Deploy to production

**Total Estimate:** 7-10 days

---

## Consequences

### Positive

✅ **Simpler Codebase**: Easier to understand and maintain  
✅ **Better Performance**: Optimized for single-node, can scale later  
✅ **Rich Features**: Easy to add new post types  
✅ **Developer Experience**: Clear architecture, good test coverage  
✅ **Type Safety**: Proto ensures consistency across platforms  

### Negative

❌ **No Federation**: Loses Mastodon compatibility (can add back later)  
❌ **Migration Effort**: Need to rewrite existing code  
❌ **Data Migration**: Old posts need conversion (skipped for now)  

### Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Breaking existing features | Comprehensive test coverage |
| Performance issues | Early performance testing |
| Frontend-backend mismatch | Proto-based contracts |
| Scope creep | MVP-first approach (TEXT, IMAGE, REPOST only) |

---

## Alternatives Considered

### Alternative 1: Keep ActivityPub, Optimize It
**Rejected because:**
- Fundamental design issues can't be fixed with optimization
- Still tied to federation complexity we don't need yet
- Difficult to add modern features

### Alternative 2: Use Existing Social Framework
**Rejected because:**
- No Go framework fits our needs
- Want full control over architecture
- Learning opportunity for team

### Alternative 3: Hybrid Approach (ActivityPub + REST)
**Rejected because:**
- Maintaining two systems is more complex
- Unclear which to use for new features
- Double the testing burden

---

## Technical Details

### Proto Design Patterns

**Using `oneof` for polymorphic posts:**
```protobuf
message Post {
  PostType type = 3;
  
  oneof content {
    TextPost text_post = 30;
    ImagePost image_post = 31;
    VideoPost video_post = 32;
    // ...
  }
}
```

**Benefits:**
- Type-safe at compile time
- Clear which fields are valid
- Efficient serialization

### Database Optimization

**Denormalized Counters:**
```sql
CREATE TABLE posts (
    likes_count BIGINT DEFAULT 0,
    comments_count BIGINT DEFAULT 0,
    reposts_count BIGINT DEFAULT 0
);
```

**Cursor Pagination:**
```sql
WHERE (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT ?
```

**Strategic Indexes:**
```sql
CREATE INDEX idx_posts_author_created ON posts(author_id, created_at DESC);
CREATE INDEX idx_posts_created ON posts(created_at DESC) WHERE deleted_at IS NULL;
```

### Frontend Architecture

**GetX Pattern:**
```dart
// Controller
class PostListController extends GetxController {
  final posts = <Post>[].obs;
  final isLoading = false.obs;
  
  Future<void> loadPosts() async {
    isLoading.value = true;
    try {
      final result = await _api.getTimeline(...);
      posts.assignAll(result.posts);
    } finally {
      isLoading.value = false;
    }
  }
}

// View
class PostListPage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final controller = Get.find<PostListController>();
    
    return Obx(() {
      if (controller.isLoading.value) {
        return LoadingIndicator();
      }
      return ListView.builder(...);
    });
  }
}
```

---

## Acceptance Criteria

### Functional Requirements
- [ ] Users can create TEXT, IMAGE, REPOST posts
- [ ] Users can view home timeline (following)
- [ ] Users can view user timeline (profile)
- [ ] Users can like/unlike posts
- [ ] Users can comment on posts
- [ ] Users can delete their own posts

### Non-Functional Requirements
- [ ] API response time < 200ms (p99)
- [ ] Unit test coverage > 80%
- [ ] All tests passing
- [ ] No `print()` or `println()` in code
- [ ] Passes `gofmt` and `flutter analyze`

### Performance Targets
- [ ] Create post: < 100ms (p99)
- [ ] Get timeline: < 200ms (p99)
- [ ] Like post: < 50ms (p99)
- [ ] System supports 1000 QPS

---

## References

### Documentation
- [POST_TYPES.md](../../../model/domain/social/POST_TYPES.md) - Detailed post type specifications
- [REFACTOR_PLAN.md](../../../station/frame/touch/social/REFACTOR_PLAN.md) - Implementation roadmap
- [post.proto](../../../model/domain/social/post.proto) - Proto definitions

### Related ADRs
- [ADR-001: Proto-First Architecture](001-proto-first-architecture.md)
- [ADR-002: No StatefulWidget](002-no-stateful-widget.md)

### External References
- [Twitter's Timeline Architecture](https://blog.twitter.com/engineering/en_us/topics/infrastructure/2017/the-infrastructure-behind-twitter-scale)
- [Instagram's Feed Architecture](https://instagram-engineering.com/what-powers-instagram-hundreds-of-instances-dozens-of-technologies-adf2e22da2ad)
- [Protocol Buffers Best Practices](https://protobuf.dev/programming-guides/dos-donts/)

---

## Review & Updates

| Date | Reviewer | Status | Notes |
|------|----------|--------|-------|
| 2025-01-09 | Team | Draft | Initial design discussion |
| TBD | Team | Review | After Phase 1 completion |
| TBD | Team | Approved | After successful deployment |

---

## Appendix: Migration Notes

### Data Migration Strategy

**Decision: Skip migration for now**

Rationale:
- Focus on new system first
- Old ActivityPub data can coexist
- Manual migration tool can be built later if needed

### Rollback Plan

If issues arise:
1. Keep old ActivityPub endpoints for 2 weeks
2. Database tables preserved for 1 month
3. Client can fallback to old API
4. Feature flag to switch between systems

### Future Federation

When adding federation back:
1. Keep new REST API for clients
2. Add ActivityPub adapter layer
3. Translate between internal models and ActivityPub
4. Federation becomes optional feature, not core requirement

---

*This ADR documents the most significant architectural change in Peers-Touch v1.0*
