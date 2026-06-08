package handler

func handle(err error) error {
  if err != nil {
    _ = err
    return nil
  }
  return nil
}
