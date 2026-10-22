/*
 * D-19 POSIX process owner. No evidence-store or business validation authority.
 * The Python contract decoder remains responsible for the concrete request and
 * result union. This backend validates canonical transport envelopes before
 * admitting a child, owns its independent timer and consumes every wait status.
 */
#define _POSIX_C_SOURCE 200809L
#ifdef __linux__
#define _GNU_SOURCE
#endif
#ifdef __APPLE__
#define _DARWIN_C_SOURCE
#endif
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <json-c/json.h>
#include <openssl/evp.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#ifdef __linux__
#include <linux/openat2.h>
#include <sys/syscall.h>
#endif

#define FRAME_LIMIT 2097152U
#define OUTPUT_LIMIT 262144U
#define QUEUE_LIMIT (4U * 1024U * 1024U)
#define DOMAIN "pt.acceptance.finalization.supervisor-control-frame.v1"
#define JSON_FLAGS (JSON_C_TO_STRING_PLAIN | JSON_C_TO_STRING_NOSLASHESCAPE)

static int control_fd = -1;
static int descriptor_fd = -1;
static int worker_descriptor_fd = -1;
static pid_t child_pid = -1;
static bool child_armed;
static const char *session_id;
static const char *runtime_digest;
static const char *python_path;
static const char *native_helper_path;

#ifdef __linux__
static bool safe_relative_path(const char *path) {
    if (!path || !*path || path[0] == '/') return false;
    const char *part = path;
    while (*part) {
        const char *end = strchr(part, '/');
        size_t length = end ? (size_t)(end - part) : strlen(part);
        if (!length || (length == 1 && part[0] == '.') ||
            (length == 2 && part[0] == '.' && part[1] == '.'))
            return false;
        if (!end) return true;
        part = end + 1;
    }
    return false;
}
#endif

static int openat2_fd_helper(int argc, char **argv) {
#ifndef __linux__
    (void)argc; (void)argv;
    return 95;
#else
    if (argc != 6 || !safe_relative_path(argv[4])) return 95;
    char *end = NULL;
    long root = strtol(argv[2], &end, 10);
    if (!end || *end || root < 3 || root > INT32_MAX) return 95;
    end = NULL;
    long channel = strtol(argv[3], &end, 10);
    if (!end || *end || channel < 3 || channel > INT32_MAX ||
        channel == root) return 95;
    bool directory = !strcmp(argv[5], "DIRECTORY");
    bool regular = !strcmp(argv[5], "REGULAR_FILE");
    bool any = !strcmp(argv[5], "ANY");
    if (!directory && !regular && !any) return 95;
    struct stat root_status;
    int socket_type = 0;
    socklen_t socket_type_size = sizeof(socket_type);
    if (fstat((int)root, &root_status) || !S_ISDIR(root_status.st_mode) ||
        getsockopt((int)channel, SOL_SOCKET, SO_TYPE,
                   &socket_type, &socket_type_size) ||
        socket_type != SOCK_DGRAM)
        return 95;
    struct open_how how;
    memset(&how, 0, sizeof(how));
    how.flags = O_RDONLY | O_CLOEXEC | O_NOFOLLOW |
        (directory ? O_DIRECTORY : 0);
    how.resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS |
        RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV;
    int opened = (int)syscall(
        SYS_openat2, (int)root, argv[4], &how, sizeof(how));
    if (opened < 0) return errno == ENOSYS ? 96 : 97;
    struct stat observed;
    if (fstat(opened, &observed) ||
        (directory ? !S_ISDIR(observed.st_mode)
                   : regular ? !S_ISREG(observed.st_mode)
                             : (!S_ISDIR(observed.st_mode) &&
                                !S_ISREG(observed.st_mode)))) {
        close(opened);
        return 97;
    }
    unsigned char marker = 1;
    struct iovec vector = {&marker, sizeof(marker)};
    union {
        struct cmsghdr alignment;
        unsigned char bytes[CMSG_SPACE(sizeof(int))];
    } control;
    memset(&control, 0, sizeof(control));
    struct msghdr message;
    memset(&message, 0, sizeof(message));
    message.msg_iov = &vector;
    message.msg_iovlen = 1;
    message.msg_control = control.bytes;
    message.msg_controllen = sizeof(control.bytes);
    struct cmsghdr *item = CMSG_FIRSTHDR(&message);
    item->cmsg_level = SOL_SOCKET;
    item->cmsg_type = SCM_RIGHTS;
    item->cmsg_len = CMSG_LEN(sizeof(int));
    memcpy(CMSG_DATA(item), &opened, sizeof(opened));
    int result = sendmsg((int)channel, &message, 0) == 1 ? 0 : 98;
    close(opened);
    return result;
#endif
}
static const char *worker_path;
static unsigned long long next_sequence = 1;

static double monotonic_now(void) {
    struct timespec value;
    if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) _exit(120);
    return (double)value.tv_sec + (double)value.tv_nsec / 1000000000.0;
}

static bool wait_ready(int fd, short events, double deadline) {
    for (;;) {
        double remaining = deadline - monotonic_now();
        if (remaining <= 0) return false;
        struct pollfd item = {fd, events, 0};
        int milliseconds = remaining > 0.1 ? 100 : (int)(remaining * 1000) + 1;
        int result = poll(&item, 1, milliseconds);
        if (result < 0 && errno == EINTR) continue;
        if (result < 0) return false;
        if (result && (item.revents & (events | POLLHUP | POLLERR))) return true;
    }
}

static bool nonblocking(int fd) {
    int flags = fcntl(fd, F_GETFL);
    return flags >= 0 && fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0;
}

/* Transport objects have ASCII schema keys and I-JSON integer scalars.
 * Unsupported numeric/key forms fail closed; they are never reserialized into
 * a different digest preimage. Business payload parsing belongs to Python.
 */
static int key_compare(const void *first, const void *second) {
    return strcmp(*(const char *const *)first, *(const char *const *)second);
}

static struct json_object *canonical_copy(struct json_object *value, unsigned depth) {
    if (depth > 32) return NULL;
    enum json_type kind = json_object_get_type(value);
    if (kind == json_type_object) {
        size_t count = json_object_object_length(value);
        if (count > 4096) return NULL;
        const char **keys = calloc(count ? count : 1, sizeof(*keys));
        if (!keys) return NULL;
        size_t index = 0;
        json_object_object_foreach(value, key, item) {
            (void)item;
            for (const unsigned char *byte = (const unsigned char *)key; *byte; byte++)
                if (*byte > 127) { free(keys); return NULL; }
            keys[index++] = key;
        }
        qsort(keys, count, sizeof(*keys), key_compare);
        struct json_object *result = json_object_new_object();
        for (index = 0; index < count; index++) {
            struct json_object *item = NULL;
            json_object_object_get_ex(value, keys[index], &item);
            struct json_object *copy = canonical_copy(item, depth + 1);
            if (item && !copy) { json_object_put(result); free(keys); return NULL; }
            json_object_object_add(result, keys[index], copy);
        }
        free(keys);
        return result;
    }
    if (kind == json_type_array) {
        size_t count = json_object_array_length(value);
        if (count > 4096) return NULL;
        struct json_object *result = json_object_new_array();
        for (size_t index = 0; index < count; index++) {
            struct json_object *item = json_object_array_get_idx(value, index);
            struct json_object *copy = canonical_copy(item, depth + 1);
            if (item && !copy) { json_object_put(result); return NULL; }
            json_object_array_add(result, copy);
        }
        return result;
    }
    if (kind == json_type_double) return NULL;
    if (kind == json_type_int) {
        int64_t number = json_object_get_int64(value);
        if (number < -9007199254740991LL || number > 9007199254740991LL) return NULL;
    }
    return json_object_get(value);
}

static const char *string_field(struct json_object *value, const char *key) {
    struct json_object *item = NULL;
    if (!json_object_object_get_ex(value, key, &item) ||
        json_object_get_type(item) != json_type_string ||
        (size_t)json_object_get_string_len(item) != strlen(json_object_get_string(item)))
        return NULL;
    return json_object_get_string(item);
}

static bool integer_field(struct json_object *value, const char *key, int64_t *number) {
    struct json_object *item = NULL;
    if (!json_object_object_get_ex(value, key, &item) ||
        json_object_get_type(item) != json_type_int) return false;
    *number = json_object_get_int64(item);
    return true;
}

static bool object_digest_matches(struct json_object *frame, const char *field,
                                  const char *domain) {
    const char *expected = string_field(frame, field);
    if (!expected || strlen(expected) != 64) return false;
    struct json_object *payload = json_object_new_object();
    json_object_object_foreach(frame, key, item) {
        if (strcmp(key, field))
            json_object_object_add(payload, key, json_object_get(item));
    }
    struct json_object *envelope = json_object_new_object();
    json_object_object_add(envelope, "domain", json_object_new_string(domain));
    json_object_object_add(envelope, "payload", payload);
    struct json_object *canonical = canonical_copy(envelope, 0);
    json_object_put(envelope);
    if (!canonical) return false;
    const char *bytes = json_object_to_json_string_ext(canonical, JSON_FLAGS);
    unsigned char hash[EVP_MAX_MD_SIZE];
    unsigned length = 0;
    bool valid = EVP_Digest(bytes, strlen(bytes), hash, &length, EVP_sha256(), NULL) == 1;
    char hex[65];
    for (unsigned index = 0; index < 32 && valid; index++)
        snprintf(hex + index * 2, 3, "%02x", hash[index]);
    valid = valid && length == 32 && !strcmp(hex, expected);
    json_object_put(canonical);
    return valid;
}

static struct json_object *decode_frame(const char *wire, size_t size) {
    struct json_tokener *parser = json_tokener_new_ex(32);
    json_tokener_set_flags(parser, JSON_TOKENER_STRICT | JSON_TOKENER_VALIDATE_UTF8);
    struct json_object *value = json_tokener_parse_ex(parser, wire, (int)size);
    bool parsed = json_tokener_get_error(parser) == json_tokener_success &&
        json_tokener_get_parse_end(parser) == size;
    json_tokener_free(parser);
    struct json_object *canonical = parsed ? canonical_copy(value, 0) : NULL;
    bool valid = canonical && json_object_get_type(value) == json_type_object;
    if (valid) {
        const char *encoded = json_object_to_json_string_ext(canonical, JSON_FLAGS);
        valid = strlen(encoded) == size && !memcmp(encoded, wire, size) &&
            object_digest_matches(value, "frameDigest", DOMAIN);
    }
    json_object_put(canonical);
    if (!valid) { json_object_put(value); return NULL; }
    return value;
}

struct frame_reader {
    unsigned char prefix[4];
    size_t prefix_used, size, used;
    char *wire;
};

/* One nonblocking read per dispatch preserves cancellation/EOF fairness even
 * when a worker sends a prefix and then stalls halfway through its payload. */
static int read_increment(struct frame_reader *reader, int fd,
                          struct json_object **frame) {
    void *destination = reader->prefix_used < 4
        ? (void *)(reader->prefix + reader->prefix_used)
        : (void *)(reader->wire + reader->used);
    size_t needed = reader->prefix_used < 4
        ? 4 - reader->prefix_used : reader->size - reader->used;
    ssize_t count = read(fd, destination, needed > 65536 ? 65536 : needed);
    if (count < 0 && (errno == EINTR || errno == EAGAIN)) return 0;
    if (count <= 0) return -1;
    if (reader->prefix_used < 4) {
        reader->prefix_used += (size_t)count;
        if (reader->prefix_used == 4) {
            uint32_t network_size;
            memcpy(&network_size, reader->prefix, 4);
            reader->size = ntohl(network_size);
            if (!reader->size || reader->size > FRAME_LIMIT) return -1;
            reader->wire = malloc(reader->size + 1);
            if (!reader->wire) return -1;
        }
        return 0;
    }
    reader->used += (size_t)count;
    if (reader->used != reader->size) return 0;
    reader->wire[reader->size] = 0;
    *frame = decode_frame(reader->wire, reader->size);
    free(reader->wire);
    memset(reader, 0, sizeof(*reader));
    return *frame ? 1 : -1;
}

static struct json_object *receive_frame(int fd, double deadline) {
    struct frame_reader reader = {0};
    struct json_object *frame = NULL;
    int result = 0;
    while (result == 0 && wait_ready(fd, POLLIN, deadline))
        result = read_increment(&reader, fd, &frame);
    free(reader.wire);
    return result == 1 ? frame : NULL;
}

static unsigned char *encode_frame(struct json_object *payload, size_t *length) {
    /* Relay envelopes use the same payload preimage as newly generated ACKs. */
    json_object_object_del(payload, "frameDigest");
    struct json_object *envelope = json_object_new_object();
    json_object_object_add(envelope, "domain", json_object_new_string(DOMAIN));
    json_object_object_add(envelope, "payload", json_object_get(payload));
    struct json_object *canonical = canonical_copy(envelope, 0);
    json_object_put(envelope);
    if (!canonical) return NULL;
    const char *preimage = json_object_to_json_string_ext(canonical, JSON_FLAGS);
    unsigned char hash[EVP_MAX_MD_SIZE];
    unsigned hash_size = 0;
    bool valid = EVP_Digest(preimage, strlen(preimage), hash, &hash_size, EVP_sha256(), NULL) == 1;
    json_object_put(canonical);
    if (!valid || hash_size != 32) return NULL;
    char hex[65];
    for (unsigned index = 0; index < 32; index++)
        snprintf(hex + index * 2, 3, "%02x", hash[index]);
    json_object_object_add(payload, "frameDigest", json_object_new_string(hex));
    canonical = canonical_copy(payload, 0);
    if (!canonical) return NULL;
    const char *wire = json_object_to_json_string_ext(canonical, JSON_FLAGS);
    size_t size = strlen(wire);
    uint32_t prefix = htonl((uint32_t)size);
    unsigned char *encoded = size && size <= FRAME_LIMIT ? malloc(size + 4) : NULL;
    if (encoded) {
        memcpy(encoded, &prefix, 4);
        memcpy(encoded + 4, wire, size);
        *length = size + 4;
    }
    json_object_put(canonical);
    return encoded;
}

struct queued_frame {
    unsigned char *wire;
    size_t size, sent;
    struct queued_frame *next;
};

static struct queued_frame *queue_head, *queue_tail;
static size_t queue_bytes;

static bool enqueue_frame(struct json_object *payload) {
    size_t size = 0;
    unsigned char *wire = encode_frame(payload, &size);
    if (!wire || size > QUEUE_LIMIT - queue_bytes) { free(wire); return false; }
    struct queued_frame *item = calloc(1, sizeof(*item));
    if (!item) { free(wire); return false; }
    item->wire = wire; item->size = size;
    if (queue_tail) queue_tail->next = item;
    else queue_head = item;
    queue_tail = item;
    queue_bytes += size;
    return true;
}

/* A bounded write per dispatch keeps Runner EOF/cancellation and the worker
 * deadline observable even when the Runner stops reading acknowledgements. */
static bool write_increment(void) {
    if (!queue_head) return true;
    size_t remaining = queue_head->size - queue_head->sent;
    ssize_t count = write(control_fd, queue_head->wire + queue_head->sent,
                          remaining > 65536 ? 65536 : remaining);
    if (count < 0 && (errno == EAGAIN || errno == EINTR)) return true;
    if (count <= 0) return false;
    queue_head->sent += (size_t)count;
    if (queue_head->sent == queue_head->size) {
        struct queued_frame *finished = queue_head;
        queue_head = finished->next;
        if (!queue_head) queue_tail = NULL;
        queue_bytes -= finished->size;
        free(finished->wire); free(finished);
    }
    return true;
}

static void clear_queue(void) {
    while (queue_head) {
        struct queued_frame *item = queue_head;
        queue_head = item->next;
        free(item->wire); free(item);
    }
    queue_tail = NULL; queue_bytes = 0;
}

/* Outside an active worker, queued replies still have a bounded delivery
 * deadline. Input is left for the request decoder; EOF terminates immediately. */
static bool flush_queue(double deadline) {
    while (queue_head && monotonic_now() < deadline) {
        struct pollfd item = {control_fd, POLLIN | POLLOUT, 0};
        int ready = poll(&item, 1, 10);
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) return false;
        if (item.revents & (POLLIN | POLLHUP | POLLERR)) {
            unsigned char byte;
            ssize_t count = recv(control_fd, &byte, 1, MSG_PEEK);
            if (count == 0 || (count < 0 && errno != EAGAIN && errno != EINTR))
                return false;
        }
        if ((item.revents & POLLOUT) && !write_increment()) return false;
    }
    return !queue_head;
}

static struct json_object *frame_new(const char *type, struct json_object *identity) {
    struct json_object *frame = json_object_new_object();
    json_object_object_add(frame, "frameType", json_object_new_string(type));
    if (identity) json_object_object_add(frame, "identity", json_object_get(identity));
    return frame;
}

static bool emit(struct json_object *frame) {
    bool success = enqueue_frame(frame);
    json_object_put(frame);
    return success;
}

static bool emit_diagnostics(struct json_object *identity, int stream,
                             const unsigned char *bytes, size_t size) {
    size_t offset = 0;
    int64_t sequence = 1;
    do {
        size_t chunk = size - offset > 65536 ? 65536 : size - offset;
        unsigned char encoded[87385];
        int encoded_size = EVP_EncodeBlock(encoded, bytes + offset, (int)chunk);
        if (encoded_size < 0) return false;
        struct json_object *frame = frame_new("WORKER_DIAGNOSTIC", identity);
        json_object_object_add(frame, "stream",
            json_object_new_string(stream == 0 ? "STDOUT" : "STDERR"));
        json_object_object_add(frame, "chunkSequence", json_object_new_int64(sequence++));
        json_object_object_add(frame, "chunkBase64",
            json_object_new_string_len((const char *)encoded, encoded_size));
        offset += chunk;
        json_object_object_add(frame, "finalChunk", json_object_new_boolean(offset == size));
        if (!emit(frame)) return false;
    } while (offset < size);
    return true;
}

static void kill_worker(void) {
    if (child_pid <= 0) return;
    if (child_armed) kill(-child_pid, SIGKILL);
    kill(child_pid, SIGKILL);
}

static bool reap_worker(int *status, double deadline) {
    while (child_pid > 0 && monotonic_now() < deadline) {
        pid_t observed = waitpid(child_pid, status, WNOHANG);
        if (observed == child_pid) { child_pid = -1; return true; }
        if (observed < 0 && errno != EINTR) return false;
        struct pollfd delay = {-1, 0, 0};
        poll(&delay, 0, 5);
    }
    return child_pid <= 0;
}

static void release_worker(void) {
    int status;
    kill_worker();
    if (!reap_worker(&status, monotonic_now() + 5)) _exit(121);
}

static bool identity_equal(struct json_object *frame, struct json_object *identity) {
    struct json_object *observed = NULL;
    return json_object_object_get_ex(frame, "identity", &observed) &&
        json_object_equal(observed, identity);
}

static bool request_digests_match(struct json_object *request,
                                  struct json_object *identity) {
    if (json_object_get_type(identity) != json_type_object ||
        json_object_object_length(identity) != 7 ||
        !object_digest_matches(identity, "requestIdentityDigest",
            "pt.acceptance.finalization.worker-request-identity.v1"))
        return false;
    const char *expected = string_field(identity, "requestPayloadDigest");
    if (!expected) return false;
    /* Every concrete request hashes its exact payload with identity removed.
     * Row-specific semantic decoding remains the captured Python contract's
     * responsibility, before WORKER_READY or any directory operation. */
    struct json_object *payload = json_object_new_object();
    json_object_object_foreach(request, key, item) {
        if (strcmp(key, "identity"))
            json_object_object_add(payload, key, json_object_get(item));
    }
    json_object_object_add(payload, "requestPayloadDigest", json_object_new_string(expected));
    bool valid = object_digest_matches(payload, "requestPayloadDigest",
        "pt.acceptance.finalization.worker-request.v1");
    json_object_put(payload);
    return valid;
}

static int descriptor_count(const char *kind) {
    if (!kind) return -1;
    if (!strcmp(kind, "FINALIZER")) return 0;
    if (!strcmp(kind, "BUNDLE_PREPARER") || !strcmp(kind, "AUTHORITY_RUNTIME_PERSISTER")) return 2;
    if (!strcmp(kind, "MAINTENANCE") || !strcmp(kind, "MATERIALIZER") ||
        !strcmp(kind, "RUNTIME_CAPTURE"))
        return 1;
    return -1;
}

static const char *descriptor_role(const char *kind, int index) {
    if (!strcmp(kind, "BUNDLE_PREPARER"))
        return index == 0 ? "REPOSITORY_ROOT" : "TEMPORARY_DIRECTORY";
    if (!strcmp(kind, "AUTHORITY_RUNTIME_PERSISTER"))
        return index == 0 ? "GATE_DIRECTORY" : "TEMPORARY_DIRECTORY";
    if (!strcmp(kind, "RUNTIME_CAPTURE")) return "TEMPORARY_DIRECTORY";
    if (!strcmp(kind, "MATERIALIZER")) return "RUN_DIRECTORY";
    return "GATE_DIRECTORY";
}

static bool validate_claim(int fd, struct json_object *claim, const char *role) {
    struct stat observed;
    const char *claimed_role = string_field(claim, "role");
    const char *type = string_field(claim, "fileType");
    const char *device = string_field(claim, "deviceId");
    const char *inode = string_field(claim, "inode");
    struct json_object *owner = NULL;
    if (fcntl(fd, F_SETFD, FD_CLOEXEC) || fstat(fd, &observed) ||
        !S_ISDIR(observed.st_mode) || observed.st_uid != geteuid() ||
        (observed.st_mode & (S_IWGRP | S_IWOTH)) ||
        (!strcmp(role, "TEMPORARY_DIRECTORY") && (observed.st_mode & 077)) ||
        !claimed_role || strcmp(claimed_role, role) || !type || strcmp(type, "DIRECTORY") ||
        !device || !inode || json_object_object_length(claim) != 7 ||
        !object_digest_matches(claim, "descriptorClaimDigest",
            "pt.acceptance.finalization.descriptor-claim.v1") ||
        !json_object_object_get_ex(claim, "ownerBinding", &owner) ||
        json_object_get_type(owner) != json_type_object)
        return false;
    char actual_device[32], actual_inode[32];
    snprintf(actual_device, sizeof(actual_device), "%llu", (unsigned long long)observed.st_dev);
    snprintf(actual_inode, sizeof(actual_inode), "%llu", (unsigned long long)observed.st_ino);
    if (strcmp(device, actual_device) || strcmp(inode, actual_inode)) return false;
    const char *owner_role = string_field(owner, "role");
    const char *expected = string_field(claim, "ownerBindingDigest");
    if (!owner_role || strcmp(owner_role, role) || !expected) return false;
    struct json_object *copy = canonical_copy(owner, 0);
    if (!copy) return false;
    json_object_object_add(copy, "ownerBindingDigest", json_object_new_string(expected));
    bool valid = object_digest_matches(copy, "ownerBindingDigest",
        "pt.acceptance.finalization.descriptor-owner-binding.v1");
    json_object_put(copy);
    return valid;
}

/* Receive all installed rights before checking shape; every failure closes
 * this request's complete installed set. Only a validated datagram is forwarded
 * to the child's anonymous FD channel. No directory remains in the parent. */
static bool prepare_descriptors(struct json_object *identity, int count, double deadline) {
    int received[16], installed = 0, pair[2] = {-1, -1};
    unsigned char wire[4096];
    union { struct cmsghdr alignment; unsigned char bytes[CMSG_SPACE(sizeof(received))]; } control;
    struct iovec vector = {wire, sizeof(wire)};
    struct msghdr message;
    memset(&message, 0, sizeof(message));
    message.msg_iov = &vector; message.msg_iovlen = 1;
    message.msg_control = control.bytes; message.msg_controllen = sizeof(control.bytes);
    ssize_t size = -1;
    while (monotonic_now() < deadline) {
        struct pollfd items[2] = {
            {control_fd, (short)(POLLIN | (queue_head ? POLLOUT : 0)), 0},
            {descriptor_fd, POLLIN, 0}
        };
        int available = poll(items, 2, 10);
        if (available < 0 && errno == EINTR) continue;
        if (available < 0 || (items[0].revents & (POLLIN | POLLHUP | POLLERR))) break;
        if ((items[0].revents & POLLOUT) && !write_increment()) break;
        if (items[1].revents) {
            size = recvmsg(descriptor_fd, &message, 0);
            if (size < 0 && (errno == EINTR || errno == EAGAIN)) continue;
            break;
        }
    }
    int cmsgs = 0;
    bool shape = size > 0 && !(message.msg_flags & (MSG_TRUNC | MSG_CTRUNC));
    if (size >= 0) {
        for (struct cmsghdr *item = CMSG_FIRSTHDR(&message); item;
             item = CMSG_NXTHDR(&message, item)) {
            cmsgs++;
            if (item->cmsg_level != SOL_SOCKET || item->cmsg_type != SCM_RIGHTS ||
                item->cmsg_len < CMSG_LEN(0)) { shape = false; continue; }
            size_t bytes = item->cmsg_len - CMSG_LEN(0);
            if (bytes % sizeof(int)) shape = false;
            size_t number = bytes / sizeof(int);
            for (size_t index = 0; index < number && installed < 16; index++) {
                memcpy(&received[installed], (unsigned char *)CMSG_DATA(item) + index * sizeof(int), sizeof(int));
                if (fcntl(received[installed], F_SETFD, FD_CLOEXEC)) shape = false;
                installed++;
            }
        }
    }
    struct json_object *frame = shape ? decode_frame((char *)wire, (size_t)size) : NULL;
    struct json_object *echo = NULL, *claims = NULL;
    const char *type = frame ? string_field(frame, "frameType") : NULL;
    bool valid = frame && cmsgs == 1 && installed == count && type &&
        !strcmp(type, "DESCRIPTOR_TRANSFER") && json_object_object_length(frame) == 4 &&
        identity_equal(frame, identity) &&
        json_object_object_get_ex(frame, "descriptorClaimDigests", &echo) &&
        json_object_get_type(echo) == json_type_array &&
        json_object_array_length(echo) == (size_t)count &&
        json_object_object_get_ex(identity, "descriptorClaims", &claims);
    const char *kind = string_field(identity, "workerKind");
    for (int index = 0; index < installed && valid; index++) {
        struct json_object *claim = json_object_array_get_idx(claims, (size_t)index);
        struct json_object *digest = json_object_array_get_idx(echo, (size_t)index);
        const char *expected = string_field(claim, "descriptorClaimDigest");
        valid = validate_claim(received[index], claim, descriptor_role(kind, index)) &&
            expected && json_object_get_type(digest) == json_type_string &&
            json_object_get_string_len(digest) == 64 &&
            !strcmp(expected, json_object_get_string(digest));
        for (int earlier = 0; earlier < index && valid; earlier++) {
            struct stat first, second;
            valid = !fstat(received[index], &first) && !fstat(received[earlier], &second) &&
                (first.st_dev != second.st_dev || first.st_ino != second.st_ino);
        }
    }
    if (valid) valid = socketpair(AF_UNIX, SOCK_DGRAM, 0, pair) == 0;
    if (valid) {
        /* Rebuild exactly one rights cmsg rather than forwarding ancillary
         * padding or relying on the sender's control buffer representation. */
        memset(control.bytes, 0, sizeof(control.bytes));
        message.msg_flags = 0;
        message.msg_controllen = CMSG_SPACE((size_t)count * sizeof(int));
        vector.iov_len = (size_t)size;
        struct cmsghdr *item = CMSG_FIRSTHDR(&message);
        item->cmsg_level = SOL_SOCKET; item->cmsg_type = SCM_RIGHTS;
        item->cmsg_len = CMSG_LEN((size_t)count * sizeof(int));
        memcpy(CMSG_DATA(item), received, (size_t)count * sizeof(int));
        valid = sendmsg(pair[0], &message, MSG_DONTWAIT) == size;
    }
    for (int index = 0; index < installed; index++) close(received[index]);
    if (pair[0] >= 0) close(pair[0]);
    if (valid) worker_descriptor_fd = pair[1];
    else if (pair[1] >= 0) close(pair[1]);
    json_object_put(frame);
    return valid;
}

static bool execute_request_inner(struct json_object *request_frame) {
    struct json_object *identity = NULL, *request = NULL, *claims = NULL;
    int64_t sequence, seconds;
    if (json_object_object_length(request_frame) != 4 ||
        !json_object_object_get_ex(request_frame, "identity", &identity) ||
        !json_object_object_get_ex(request_frame, "request", &request) ||
        json_object_get_type(request) != json_type_object ||
        !identity_equal(request, identity) ||
        !request_digests_match(request, identity) ||
        !integer_field(identity, "sequence", &sequence) ||
        sequence < 1 || (unsigned long long)sequence != next_sequence ||
        (!integer_field(request, "timeoutSeconds", &seconds) &&
         !(string_field(request, "operation") &&
           !strcmp(string_field(request, "operation"), "WRITE_ABORT_EVENT") && (seconds = 60))) ||
        seconds < 1 || seconds > 60)
        return false;
    const char *owner = string_field(identity, "supervisorSessionId");
    const char *kind = string_field(identity, "workerKind");
    int count = descriptor_count(kind);
    if (!owner || strcmp(owner, session_id) || count < 0 ||
        !json_object_object_get_ex(identity, "descriptorClaims", &claims) ||
        json_object_get_type(claims) != json_type_array ||
        json_object_array_length(claims) != (size_t)count ||
        (count && (descriptor_fd < 0 || !prepare_descriptors(identity, count, monotonic_now() + (double)seconds))))
        return false;
    struct json_object *accepted = frame_new("REQUEST_ACCEPTED", identity);
    struct json_object *accepted_claims = json_object_new_array();
    for (int index = 0; index < count; index++)
        json_object_array_add(accepted_claims, json_object_new_string(
            string_field(json_object_array_get_idx(claims, (size_t)index), "descriptorClaimDigest")));
    json_object_object_add(accepted, "acceptedDescriptorClaimDigests", accepted_claims);
    if (!emit(accepted)) return false;

    int worker_pair[2], setup_pipe[2], output_pipe[2][2] = {{-1, -1}, {-1, -1}};
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, worker_pair) != 0) return false;
    if (pipe(setup_pipe) != 0) { close(worker_pair[0]); close(worker_pair[1]); return false; }
    for (int stream = 0; stream < 2; stream++) {
        if (pipe(output_pipe[stream]) != 0) {
            for (int index = 0; index < 2; index++)
                for (int end = 0; end < 2; end++)
                    if (output_pipe[index][end] >= 0) close(output_pipe[index][end]);
            close(worker_pair[0]); close(worker_pair[1]);
            close(setup_pipe[0]); close(setup_pipe[1]);
            return false;
        }
    }
    child_armed = false;
    double deadline = monotonic_now() + (double)seconds;
    child_pid = fork();
    if (child_pid == 0) {
        int datagram = worker_descriptor_fd >= 0 ? fcntl(worker_descriptor_fd, F_DUPFD, 10) : -1;
        if (worker_descriptor_fd >= 0 && datagram < 0) _exit(122);
        close(worker_pair[0]); close(setup_pipe[0]); close(control_fd);
        for (int stream = 0; stream < 2; stream++) {
            close(output_pipe[stream][0]);
            if (dup2(output_pipe[stream][1], stream + 1) < 0) _exit(122);
            close(output_pipe[stream][1]);
        }
        if (setpgid(0, 0) != 0) _exit(122);
        sigset_t alarm_mask;
        sigemptyset(&alarm_mask); sigaddset(&alarm_mask, SIGALRM);
        struct sigaction action;
        memset(&action, 0, sizeof(action));
        action.sa_handler = SIG_DFL;
        sigemptyset(&action.sa_mask);
        if (sigprocmask(SIG_UNBLOCK, &alarm_mask, NULL) != 0 ||
            sigaction(SIGALRM, &action, NULL) != 0) _exit(122);
        struct itimerval timer = {{0, 0}, {(time_t)seconds, 0}}, observed;
        if (setitimer(ITIMER_REAL, &timer, NULL) != 0 ||
            getitimer(ITIMER_REAL, &observed) != 0 ||
            observed.it_interval.tv_sec || observed.it_interval.tv_usec ||
            (observed.it_value.tv_sec == 0 && observed.it_value.tv_usec == 0) ||
            observed.it_value.tv_sec > seconds) _exit(122);
        unsigned char armed = 1;
        if (write(setup_pipe[1], &armed, 1) != 1) _exit(122);
        close(setup_pipe[1]);
        if (worker_pair[1] != 3 && dup2(worker_pair[1], 3) < 0) _exit(122);
        if (fcntl(3, F_SETFD, 0) != 0) _exit(122);
        if (datagram >= 0 && (dup2(datagram, 4) < 0 || fcntl(4, F_SETFD, 0))) _exit(122);
        struct rlimit descriptors;
        if (getrlimit(RLIMIT_NOFILE, &descriptors) != 0) _exit(122);
        /* No inherited directory, lock, datagram, credential or parent FD. */
        long maximum = descriptors.rlim_cur == RLIM_INFINITY ? 65536 : (long)descriptors.rlim_cur;
        for (int fd = datagram >= 0 ? 5 : 4; fd < maximum; fd++) close(fd);
        char *argv_with_descriptors[] = {
            (char *)python_path, "-I", "-S", "-E", "-B", (char *)worker_path,
            "--control-fd", "3", "--descriptor-fd", "4",
            "--supervisor-session-id", (char *)session_id,
            "--supervisor-runtime-digest", (char *)runtime_digest,
            "--native-helper-path", (char *)native_helper_path, NULL
        };
        char *argv_without_descriptors[] = {
            (char *)python_path, "-I", "-S", "-E", "-B", (char *)worker_path,
            "--control-fd", "3", "--supervisor-session-id", (char *)session_id,
            "--supervisor-runtime-digest", (char *)runtime_digest,
            "--native-helper-path", (char *)native_helper_path, NULL
        };
        char *environment[] = {"LANG=C.UTF-8", "LC_ALL=C.UTF-8", NULL};
        execve(python_path,
               datagram >= 0 ? argv_with_descriptors : argv_without_descriptors,
               environment);
        _exit(123);
    }
    if (worker_descriptor_fd >= 0) { close(worker_descriptor_fd); worker_descriptor_fd = -1; }
    close(worker_pair[1]); close(setup_pipe[1]);
    for (int stream = 0; stream < 2; stream++) {
        close(output_pipe[stream][1]);
        nonblocking(output_pipe[stream][0]);
    }
    if (child_pid < 0) {
        close(worker_pair[0]); close(setup_pipe[0]);
        for (int stream = 0; stream < 2; stream++) close(output_pipe[stream][0]);
        return false;
    }
    if (setpgid(child_pid, child_pid) != 0 && errno != EACCES && errno != ESRCH) {
        release_worker(); close(worker_pair[0]); close(setup_pipe[0]);
        for (int stream = 0; stream < 2; stream++) close(output_pipe[stream][0]);
        return false;
    }
    nonblocking(worker_pair[0]); nonblocking(setup_pipe[0]);
    bool success = true, cancelled = false, timeout = false, got_result = false, got_ready = false;
    unsigned char armed = 0;
    /* Poll both channels during pre-exec setup; runner EOF is never ignored. */
    while (!child_armed && monotonic_now() < deadline) {
        struct pollfd items[2] = {
            {control_fd, (short)(POLLIN | (queue_head ? POLLOUT : 0)), 0},
            {setup_pipe[0], POLLIN, 0}
        };
        if (poll(items, 2, 10) < 0 && errno != EINTR) { success = false; break; }
        if (items[0].revents & (POLLIN | POLLHUP | POLLERR)) { success = false; break; }
        if ((items[0].revents & POLLOUT) && !write_increment()) { success = false; break; }
        if (items[1].revents) {
            if (read(setup_pipe[0], &armed, 1) != 1 || armed != 1) { success = false; break; }
            child_armed = true;
        }
    }
    close(setup_pipe[0]);
    if (!child_armed) success = false;
    if (success) {
        struct json_object *frame = frame_new("WORKER_ARMED", identity);
        json_object_object_add(frame, "pid", json_object_new_int64(child_pid));
        json_object_object_add(frame, "pgid", json_object_new_int64(child_pid));
        json_object_object_add(frame, "timerKind", json_object_new_string("ITIMER_REAL"));
        json_object_object_add(frame, "timerSeconds", json_object_new_int64(seconds));
        success = emit(frame);
    }
    size_t request_size = 0, request_sent = 0;
    unsigned char *request_wire = success ? encode_frame(request_frame, &request_size) : NULL;
    if (success && !request_wire) success = false;
    struct frame_reader runner_reader = {0}, worker_reader = {0};
    unsigned char *output[2] = {malloc(OUTPUT_LIMIT), malloc(OUTPUT_LIMIT)};
    size_t output_used[2] = {0, 0};
    bool output_closed[2] = {false, false};
    if (!output[0] || !output[1]) success = false;
    int status = 0;
    const char *cancel_reason = NULL;
    struct json_object *cancel_frame = NULL, *result_frame = NULL;
    while (success && child_pid > 0) {
        if (monotonic_now() >= deadline) { timeout = true; break; }
        struct pollfd items[4] = {
            {control_fd, (short)(POLLIN | (queue_head ? POLLOUT : 0)), 0},
            {worker_pair[0], (short)(POLLIN | (request_sent < request_size ? POLLOUT : 0)), 0},
            {output_closed[0] ? -1 : output_pipe[0][0], POLLIN, 0},
            {output_closed[1] ? -1 : output_pipe[1][0], POLLIN, 0},
        };
        if (poll(items, 4, 10) < 0 && errno != EINTR) { success = false; break; }
        if (items[0].revents & (POLLIN | POLLHUP | POLLERR)) {
            int received = read_increment(&runner_reader, control_fd, &cancel_frame);
            if (received < 0) { success = false; break; }
            if (received == 1) {
                const char *type = string_field(cancel_frame, "frameType");
                cancel_reason = string_field(cancel_frame, "reason");
                cancelled = type && !strcmp(type, "WORKER_CANCEL_REQUEST") &&
                    json_object_object_length(cancel_frame) == 4 &&
                    identity_equal(cancel_frame, identity) && cancel_reason &&
                    (!strcmp(cancel_reason, "ORCHESTRATOR_CANCEL") || !strcmp(cancel_reason, "SESSION_CLOSE"));
                if (!cancelled) success = false;
                break;
            }
        }
        if ((items[0].revents & POLLOUT) && !write_increment()) {
            success = false; break;
        }
        if (items[1].revents & POLLOUT) {
            size_t remaining = request_size - request_sent;
            ssize_t written = write(worker_pair[0], request_wire + request_sent,
                                    remaining > 65536 ? 65536 : remaining);
            if (written > 0) request_sent += (size_t)written;
            else if (written == 0 || (errno != EINTR && errno != EAGAIN)) {
                success = false; break;
            }
        }
        for (int stream = 0; stream < 2 && success; stream++) {
            if (!items[stream + 2].revents) continue;
            unsigned char bytes[65536];
            ssize_t count = read(output_pipe[stream][0], bytes, sizeof(bytes));
            if (count > 0) {
                if ((size_t)count > OUTPUT_LIMIT - output_used[stream]) success = false;
                else {
                    memcpy(output[stream] + output_used[stream], bytes, (size_t)count);
                    output_used[stream] += (size_t)count;
                }
            } else if (count == 0) output_closed[stream] = true;
            else if (errno != EINTR && errno != EAGAIN) success = false;
        }
        if (!success) break;
        unsigned char pending_byte;
        ssize_t pending = recv(worker_pair[0], &pending_byte, 1, MSG_PEEK);
        if ((items[1].revents & POLLIN) && pending > 0) {
            struct json_object *frame = NULL;
            int received = read_increment(&worker_reader, worker_pair[0], &frame);
            if (received < 0) { success = false; break; }
            if (received == 0) continue;
            const char *type = frame ? string_field(frame, "frameType") : NULL;
            success = frame && identity_equal(frame, identity) && type;
            if (success && !strcmp(type, "WORKER_READY") && !got_ready) {
                struct json_object *echo = NULL;
                int64_t remaining;
                success = json_object_object_length(frame) == 5 &&
                    json_object_object_get_ex(frame, "validatedDescriptorClaimDigests", &echo) &&
                    json_object_get_type(echo) == json_type_array &&
                    json_object_array_length(echo) == (size_t)count &&
                    integer_field(frame, "timerRemainingMicros", &remaining) &&
                    remaining > 0 && remaining <= seconds * 1000000;
                for (int index = 0; index < count && success; index++) {
                    struct json_object *digest = json_object_array_get_idx(echo, (size_t)index);
                    const char *expected = string_field(
                        json_object_array_get_idx(claims, (size_t)index), "descriptorClaimDigest");
                    success = expected && json_object_get_type(digest) == json_type_string &&
                        json_object_get_string_len(digest) == 64 &&
                        !strcmp(expected, json_object_get_string(digest));
                }
                got_ready = success;
            } else if (success && !strcmp(type, "WORKER_RESULT") && got_ready && !got_result) {
                struct json_object *result = NULL;
                success = json_object_object_length(frame) == 4 &&
                    json_object_object_get_ex(frame, "result", &result) &&
                    json_object_get_type(result) == json_type_object &&
                    identity_equal(result, identity);
                if (success) {
                    const char *worker_kind = string_field(
                        identity, "workerKind");
                    success = worker_kind && (
                        (!strcmp(worker_kind, "MAINTENANCE") &&
                         object_digest_matches(
                             result, "resultDigest",
                             "pt.acceptance.finalization.maintenance-result.v1"
                         )) ||
                        (strcmp(worker_kind, "MAINTENANCE") &&
                         object_digest_matches(
                             result, "workerResultDigest",
                             "pt.acceptance.finalization.worker-result.v1"
                         ))
                    );
                }
                if (success) {
                    got_result = true;
                    result_frame = json_object_get(frame);
                }
            } else success = false;
            if (success && !got_result) success = enqueue_frame(frame);
            json_object_put(frame);
            if (!success) break;
        }
        /* Drain queued frames before consuming an exit; result may be queued
         * when waitpid first becomes ready. HUP without data is terminal. */
        if (pending <= 0) {
            if (pending == 0 && (worker_reader.prefix_used || worker_reader.wire)) {
                success = false; break;
            }
            siginfo_t exited;
            memset(&exited, 0, sizeof(exited));
            int waited = waitid(P_PID, (id_t)child_pid, &exited, WEXITED | WNOHANG | WNOWAIT);
            if (waited == 0 && exited.si_pid == child_pid) {
                /* Keep PID owned until group teardown; consuming wait first
                 * would expose a PID/PGID reuse race for surviving children. */
                kill_worker();
                if (!reap_worker(&status, monotonic_now() + 5)) success = false;
                if (worker_reader.prefix_used || worker_reader.wire ||
                    runner_reader.prefix_used || runner_reader.wire) success = false;
                break;
            }
            if (waited < 0 && errno != EINTR) { success = false; break; }
        }
    }
    free(request_wire); free(runner_reader.wire); free(worker_reader.wire);
    if (child_pid > 0) {
        kill_worker();
        if (!reap_worker(&status, monotonic_now() + 5)) success = false;
    }
    close(worker_pair[0]);
    for (int stream = 0; stream < 2; stream++) {
        /* A reaped no-child worker leaves only bounded queued pipe bytes. */
        while (success && !output_closed[stream]) {
            unsigned char bytes[65536];
            ssize_t count = read(output_pipe[stream][0], bytes, sizeof(bytes));
            if (count == 0) output_closed[stream] = true;
            else if (count > 0 && (size_t)count <= OUTPUT_LIMIT - output_used[stream]) {
                memcpy(output[stream] + output_used[stream], bytes, (size_t)count);
                output_used[stream] += (size_t)count;
            } else if (count < 0 && errno == EINTR) continue;
            else success = false;
        }
        close(output_pipe[stream][0]);
    }
    if (success && got_ready && !cancelled) {
        for (int stream = 0; stream < 2 && success; stream++)
            success = emit_diagnostics(identity, stream, output[stream], output_used[stream]);
        if (success && result_frame) success = emit(json_object_get(result_frame));
    }
    free(output[0]); free(output[1]);
    json_object_put(result_frame);
    if (success && child_pid <= 0) {
        struct json_object *terminal;
        if (cancelled) {
            terminal = frame_new("WORKER_CANCELLED", identity);
            json_object_object_add(terminal, "reason", json_object_new_string(cancel_reason));
        } else if (timeout || (WIFSIGNALED(status) && WTERMSIG(status) == SIGALRM)) {
            terminal = frame_new("WORKER_TIMEOUT", identity);
            json_object_object_add(terminal, "deadlineOwner", json_object_new_string(
                timeout ? "SUPERVISOR_MONOTONIC" : "CHILD_ITIMER_REAL"));
        } else if (WIFSIGNALED(status)) {
            terminal = frame_new("WORKER_SIGNALED", identity);
            json_object_object_add(terminal, "signalNumber", json_object_new_int(WTERMSIG(status)));
        } else {
            if (WEXITSTATUS(status) == 0 && !got_result) success = false;
            terminal = frame_new("WORKER_EXITED", identity);
            json_object_object_add(terminal, "exitCode", json_object_new_int(WEXITSTATUS(status)));
        }
        if (success) success = emit(terminal);
        else json_object_put(terminal);
        next_sequence++;
    }
    json_object_put(cancel_frame);
    return success;
}

static bool execute_request(struct json_object *frame) {
    bool valid = execute_request_inner(frame);
    if (worker_descriptor_fd >= 0) {
        close(worker_descriptor_fd); worker_descriptor_fd = -1;
    }
    return valid;
}

int main(int argc, char **argv) {
    if (argc > 1 && !strcmp(argv[1], "--openat2-fd"))
        return openat2_fd_helper(argc, argv);
    /* The owner supplies verified absolute executable paths and an isolated cwd.
     * Runtime identity verification is performed before launching this backend. */
    if (argc != 8 || argv[0][0] != '/' ||
        argv[4][0] != '/' || argv[5][0] != '/') return 124;
    char *end = NULL;
    long descriptor = strtol(argv[1], &end, 10);
    if (!end || *end || descriptor < 3 || descriptor > INT32_MAX) return 124;
    control_fd = (int)descriptor;
    end = NULL;
    descriptor = strtol(argv[6], &end, 10);
    if (!end || *end || descriptor < 3 || descriptor > INT32_MAX ||
        descriptor == control_fd) return 124;
    descriptor_fd = (int)descriptor;
    int datagram_type = 0; socklen_t length = sizeof(datagram_type);
    struct sockaddr_storage datagram_address; socklen_t address_length = sizeof(datagram_address);
    if (getsockopt(descriptor_fd, SOL_SOCKET, SO_TYPE, &datagram_type, &length) ||
        datagram_type != SOCK_DGRAM ||
        getsockname(descriptor_fd, (struct sockaddr *)&datagram_address, &address_length) ||
        datagram_address.ss_family != AF_UNIX || !nonblocking(descriptor_fd)) return 124;
    end = NULL;
    long cwd_descriptor = strtol(argv[7], &end, 10);
    struct stat cwd_status;
    if (!end || *end || cwd_descriptor < 3 || cwd_descriptor > INT32_MAX ||
        cwd_descriptor == control_fd || cwd_descriptor == descriptor_fd ||
        fstat((int)cwd_descriptor, &cwd_status) || !S_ISDIR(cwd_status.st_mode) ||
        cwd_status.st_uid != geteuid() || (cwd_status.st_mode & 077) ||
        fchdir((int)cwd_descriptor) || close((int)cwd_descriptor)) return 124;
    session_id = argv[2]; runtime_digest = argv[3]; python_path = argv[4];
    worker_path = argv[5]; native_helper_path = argv[0];
    int type = 0; socklen_t type_size = sizeof(type);
    struct sockaddr_storage address; socklen_t address_size = sizeof(address);
    if (getsockopt(control_fd, SOL_SOCKET, SO_TYPE, &type, &type_size) ||
        type != SOCK_STREAM || getsockname(control_fd, (struct sockaddr *)&address, &address_size) ||
        address.ss_family != AF_UNIX || !nonblocking(control_fd)) return 124;
    signal(SIGPIPE, SIG_IGN);
    struct itimerval timer;
    if (getitimer(ITIMER_REAL, &timer) != 0) return 124;
    struct json_object *ready = frame_new("SUPERVISOR_READY", NULL);
    json_object_object_add(ready, "supervisorSessionId", json_object_new_string(session_id));
    json_object_object_add(ready, "supervisorRuntimeDigest", json_object_new_string(runtime_digest));
    json_object_object_add(ready, "protocolVersion", json_object_new_int(1));
    if (!emit(ready) || !flush_queue(monotonic_now() + 2)) {
        clear_queue(); close(control_fd); return 125;
    }
    bool closed = false;
    while (!closed) {
        /* A live Runner may spend longer than a worker ceiling in a product
         * Journey. Only an in-progress frame/request has a deadline. */
        struct pollfd idle = {control_fd, POLLIN, 0};
        int available;
        do { available = poll(&idle, 1, -1); } while (available < 0 && errno == EINTR);
        if (available < 0) break;
        struct json_object *frame = receive_frame(control_fd, monotonic_now() + 60);
        const char *kind = frame ? string_field(frame, "frameType") : NULL;
        if (!kind) { json_object_put(frame); break; }
        if (!strcmp(kind, "WORKER_REQUEST")) {
            if (!execute_request(frame)) { json_object_put(frame); break; }
            if (!flush_queue(monotonic_now() + 2)) { json_object_put(frame); break; }
        } else if (!strcmp(kind, "SUPERVISOR_CLOSE")) {
            const char *owner = string_field(frame, "supervisorSessionId");
            int64_t sequence;
            if (json_object_object_length(frame) == 4 && owner && !strcmp(owner, session_id) &&
                integer_field(frame, "lastSequence", &sequence) &&
                sequence >= 0 && (unsigned long long)sequence == next_sequence - 1 && child_pid <= 0) {
                struct json_object *ack = frame_new("SUPERVISOR_CLOSE_ACK", NULL);
                json_object_object_add(ack, "supervisorSessionId", json_object_new_string(session_id));
                json_object_object_add(ack, "lastSequence", json_object_new_int64(sequence));
                json_object_object_add(ack, "allWorkersReaped", json_object_new_boolean(true));
                closed = emit(ack) && flush_queue(monotonic_now() + 2);
            }
            json_object_put(frame);
            break;
        } else { json_object_put(frame); break; }
        json_object_put(frame);
    }
    release_worker();
    clear_queue();
    if (descriptor_fd >= 0) close(descriptor_fd);
    close(control_fd);
    return closed ? 0 : 126;
}
