package auth

type Service struct {
	providers     map[Method]Provider
	defaultMethod Method
}

func NewService() *Service {
	return &Service{providers: map[Method]Provider{}}
}

func (s *Service) Register(p Provider) {
	s.providers[p.Method()] = p
}

func (s *Service) Provider(m Method) Provider {
	return s.providers[m]
}

func (s *Service) Default() Provider {
	return s.providers[s.defaultMethod]
}

func (s *Service) SetDefault(m Method) {
	s.defaultMethod = m
}
