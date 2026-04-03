use crate::infrastructure::station_client;
use crate::model::actor;
use reqwest::Method;

pub fn search_actors(token: &str, query: &str) -> Result<actor::ActorList, String> {
    station_client::request_proto::<actor::ActorList, actor::ActorList>(
        Method::GET,
        "/search",
        token,
        Some(&[("q", query.to_string())]),
        None,
    )
}

pub fn get_my_profile(token: &str) -> Result<actor::ActorProfile, String> {
    station_client::request_proto::<actor::ActorProfile, actor::ActorProfile>(
        Method::GET,
        "/profile",
        token,
        None,
        None,
    )
}
