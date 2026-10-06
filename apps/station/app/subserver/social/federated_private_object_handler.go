package social

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

func (s *subServer) handleFederatedPrivateObjectRead(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	if strings.TrimSpace(strings.ToLower(
		socialObjectHeader(request, "Content-Type"),
	)) != "application/protobuf" {
		response.WriteHeader(http.StatusBadRequest)

		return nil
	}
	objectID, err := socialObjectPathValue(
		request.Path(),
		"/federation/social/private/objects/",
		"/read",
	)
	if err != nil || strings.Contains(request.Path(), "?") {
		response.WriteHeader(http.StatusBadRequest)

		return nil
	}
	body, err := readFederatedPrivateObjectRequestBody(request)
	if err != nil {
		response.WriteHeader(http.StatusBadRequest)

		return nil
	}
	decoded, canonical, err :=
		socialdomain.DecodeCanonicalFederatedPrivateObjectReadRequest(body)
	if err != nil {
		response.WriteHeader(http.StatusBadRequest)

		return nil
	}
	download, err := s.privateObjectSvc.ReadFederatedPrivateObjectRange(
		ctx,
		httpadapter.GetVerifiedClaims(ctx),
		objectID,
		decoded,
		canonical,
	)
	if err != nil {
		writeFederatedPrivateObjectReadError(response, err)

		return nil
	}
	metadata, err := socialdomain.EncodeFederatedPrivateObjectMetadataHeader(
		&privatecontentpb.ReadFederatedPrivateObjectResponse{
			DescriptorSha256: download.DescriptorSHA256,
			Range: &privatecontentpb.FederatedPrivateObjectRange{
				Start:        uint64(download.Start),
				EndExclusive: uint64(download.End) + 1,
			},
			TotalCiphertextSize: download.TotalSize,
		},
	)
	if err != nil {
		_ = download.Body.Close()
		writeFederatedPrivateObjectReadError(
			response,
			socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				"social.private_object.peer_response",
				err,
			),
		)

		return nil
	}
	descriptorHex := hex.EncodeToString(download.DescriptorSHA256)
	length := uint64(download.End-download.Start) + 1
	response.SetHeader("Content-Type", "application/octet-stream")
	response.SetHeader("Accept-Ranges", "bytes")
	response.SetHeader("Content-Length", strconv.FormatUint(length, 10))
	response.SetHeader(
		"Content-Range",
		fmt.Sprintf(
			"bytes %d-%d/%d",
			download.Start,
			download.End,
			download.TotalSize,
		),
	)
	response.SetHeader("ETag", `"sha256:`+descriptorHex+`"`)
	response.SetHeader("X-Descriptor-SHA256", descriptorHex)
	response.SetHeader(
		"X-Total-Ciphertext-Size",
		strconv.FormatUint(download.TotalSize, 10),
	)
	response.SetHeader("X-Peers-Social-Object-Metadata", metadata)
	response.WriteHeader(http.StatusPartialContent)
	if streaming, ok := response.(server.StreamingResponse); ok {
		return streaming.SetBodyStream(download.Body, int64(length))
	}
	defer download.Body.Close()
	_, err = io.Copy(response, download.Body)

	return err
}

func readFederatedPrivateObjectRequestBody(
	request server.Request,
) ([]byte, error) {
	var reader io.Reader = bytes.NewReader(request.Body())
	if streaming, ok := request.(server.StreamingRequest); ok {
		reader = streaming.BodyStream()
	}
	body, err := io.ReadAll(io.LimitReader(
		reader,
		socialdomain.FederatedPrivateObjectRequestLimit+1,
	))
	if err != nil {
		return nil, err
	}
	if len(body) == 0 ||
		len(body) > socialdomain.FederatedPrivateObjectRequestLimit {
		return nil, errors.New(
			"federated private-object request body has an invalid size",
		)
	}

	return body, nil
}

func writeFederatedPrivateObjectReadError(
	response server.Response,
	err error,
) {
	status := http.StatusNotFound
	switch socialdomain.PrivateContentCodeOf(err) {
	case socialdomain.PrivateContentInvalidArgument:
		status = http.StatusRequestedRangeNotSatisfiable
	case socialdomain.PrivateContentDependency,
		socialdomain.PrivateContentInternal:
		status = http.StatusServiceUnavailable
	}
	response.WriteHeader(status)
}
