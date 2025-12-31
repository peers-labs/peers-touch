/// Package protocol provides core interfaces for protocol routing and negotiation in libp2p.
///
/// This file contains the Switch interface, which combines Router and Negotiator.
library;

import 'package:peers_touch_base/network/libp2p/core/protocol/protocol.dart';

/// Switch is the component responsible for "dispatching" incoming stream requests to
/// their corresponding stream handlers. It is both a Negotiator and a Router.
abstract class ProtocolSwitch implements Router, Negotiator {}