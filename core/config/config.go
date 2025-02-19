package config

/***
yml:
first-level:
  second-level:
    third-level: value
    third-level-2: value-2
  second-level-2:
    third-level: value
    third-level-2: value-2
---
Option

type config struct {
	firstLevel struct {
		secondLevel struct {
			thirdLevel string
			thirdLevel2 string
		} json:"second-level"
		secondLevel2 struct {
			thirdLevel string
			thirdLevel2 string
		} json:"second-level-2"
	} json:"first-level"
}

*/
