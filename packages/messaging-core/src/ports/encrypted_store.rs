pub trait EncryptedStore: Send + Sync {
    type Connection<'a>: StoreConnection
    where
        Self: 'a;

    fn connection(&self) -> Result<Self::Connection<'_>, String>;
}

pub trait StoreConnection {
    fn execute(&self, sql: &str, params: &[&dyn ToSqlParam]) -> Result<usize, String>;
    fn query_row<T>(
        &self,
        sql: &str,
        params: &[&dyn ToSqlParam],
        mapper: &dyn Fn(&dyn Row) -> T,
    ) -> Result<Option<T>, String>;
    fn query_rows<T>(
        &self,
        sql: &str,
        params: &[&dyn ToSqlParam],
        mapper: &dyn Fn(&dyn Row) -> T,
    ) -> Result<Vec<T>, String>;
    fn transaction<T>(&self, f: &dyn Fn(&Self) -> Result<T, String>) -> Result<T, String>;
}

pub trait Row {
    fn get_i32(&self, index: usize) -> Result<i32, String>;
    fn get_i64(&self, index: usize) -> Result<i64, String>;
    fn get_string(&self, index: usize) -> Result<String, String>;
    fn get_bytes(&self, index: usize) -> Result<Vec<u8>, String>;
    fn get_optional_string(&self, index: usize) -> Result<Option<String>, String>;
    fn get_optional_bytes(&self, index: usize) -> Result<Option<Vec<u8>>, String>;
}

pub trait ToSqlParam {
    fn as_sql_value(&self) -> SqlValue;
}

pub enum SqlValue {
    Null,
    Integer(i64),
    Text(String),
    Blob(Vec<u8>),
}
