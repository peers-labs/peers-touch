use crate::infrastructure::station_client;
use prost::Message;
use reqwest::Method;

pub fn request_proto<Req, Resp>(
    method: Method,
    path: &str,
    token: &str,
    body: Option<&Req>,
) -> Result<Resp, String>
where
    Req: Message,
    Resp: Message + Default,
{
    station_client::request_proto::<Req, Resp>(method, path, token, None, body)
}

pub fn proto_to_bytes<M: Message>(msg: &M) -> Vec<u8> {
    msg.encode_to_vec()
}
