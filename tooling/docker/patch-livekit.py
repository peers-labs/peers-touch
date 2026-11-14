#!/usr/bin/env python3
"""Apply the reviewed admission changes to exactly LiveKit v1.13.0."""
import hashlib
import pathlib
import sys

root = pathlib.Path(sys.argv[1])


def patch(relative, digest, changes):
    path = root / relative
    original = path.read_bytes()
    if hashlib.sha256(original).hexdigest() != digest:
        raise SystemExit(f"Unreviewed LiveKit source: {relative}")
    source = original.decode()
    for before, after in changes:
        if source.count(before) != 1:
            raise SystemExit(f"Non-unique LiveKit patch anchor: {relative}")
        source = source.replace(before, after, 1)
    path.write_text(source)


patch("pkg/service/roommanager.go",
      "3d50ac43d781040a2ebdfe5c374ff5e0fdae5a0345a663d00f62533bead5dfeb", [
    ("type RoomManager struct {\n\tlock sync.RWMutex",
     "type RoomManager struct {\n\tpeersEndpointFences [256]sync.Mutex\n\tlock sync.RWMutex"),
    (") error {\n\tsessionStartTime := time.Now()\n\n\tcreateRoom := pi.CreateRoom",
     """) error {
	if pi.CreateRoom == nil {
		return errors.New("missing room")
	}
	defer r.lockPeersEndpoint(pi.CreateRoom.Name, string(pi.Identity))()
	if err := ctx.Err(); err != nil {
		return err
	}
	if peersGroupRoom(pi.CreateRoom.Name) && pi.Identity != "" && !peersEndpointIdentity(string(pi.Identity)) {
		return errors.New("group media requires an endpoint grant identity")
	}
	sessionStartTime := time.Now()

	createRoom := pi.CreateRoom"""),
    ("\t\tif pi.Reconnect {\n\t\t\tif participant.IsClosed() {",
     """		if pi.Reconnect {
			if peersGroupRoom(createRoom.Name) && pi.ID != participant.ID() {
				return errors.New("group media resume SID mismatch")
			}
			if participant.IsClosed() {"""),
    ("\tsid := livekit.ParticipantID(guid.New(utils.ParticipantPrefix))",
     """	if peersGroupRoom(createRoom.Name) {
		// Every NEW SID starts without media, including SFU-refreshed JWTs.
		// Same-SID signal resume returns above without changing permission.
		pi.Grants, err = peersInitialGrants(pi.Grants)
		if err != nil {
			return err
		}
	}
	sid := livekit.ParticipantID(guid.New(utils.ParticipantPrefix))"""),
    ("func (r *RoomManager) RemoveParticipant(ctx context.Context, req *livekit.RoomParticipantIdentity) (*livekit.RemoveParticipantResponse, error) {\n",
     """func (r *RoomManager) RemoveParticipant(ctx context.Context, req *livekit.RoomParticipantIdentity) (*livekit.RemoveParticipantResponse, error) {
	defer r.lockPeersEndpoint(req.Room, req.Identity)()
	if err := ctx.Err(); err != nil { return nil, err }
"""),
    ("func (r *RoomManager) UpdateParticipant(ctx context.Context, req *livekit.UpdateParticipantRequest) (*livekit.ParticipantInfo, error) {\n",
     """func (r *RoomManager) UpdateParticipant(ctx context.Context, req *livekit.UpdateParticipantRequest) (*livekit.ParticipantInfo, error) {
	defer r.lockPeersEndpoint(req.Room, req.Identity)()
	if err := ctx.Err(); err != nil { return nil, err }
"""),
    ("\tif err = participant.UpdateMetadata(&livekit.UpdateParticipantMetadata{\n\t\tName:       req.Name,",
     """	if peersGroupRoom(req.Room) {
		expectedSID, controlErr := peersExpectedSID(req)
		if controlErr != nil { return nil, controlErr }
		if !peersEndpointIdentity(req.Identity) || expectedSID != string(participant.ID()) {
			return nil, errors.New("group media admission SID mismatch")
		}
		if participant.IsClosed() { return nil, ErrParticipantNotFound }
	}
	if err = participant.UpdateMetadata(&livekit.UpdateParticipantMetadata{
		Name:       req.Name,"""),
])
patch("pkg/service/server.go",
      "8c4ab9526cdf69bf2a70b5d3dd2b3417fa9cb2d2bb4a656673c36612a9c4b92c", [
    ("\txtwirp.RegisterServer(mux, roomServer)",
     '\tmux.HandleFunc("/.well-known/peers-touch/group-admission", peersAdmissionCapabilities)\n\txtwirp.RegisterServer(mux, roomServer)'),
])
