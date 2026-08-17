.PHONY: testnet-p5-federation-e2e chat-mls-three-station-convergence

testnet-p5-federation-e2e:
	python3 tooling/scripts/testnet-federation-e2e.py

chat-mls-three-station-convergence:
	python3 tooling/scripts/chat-mls-three-station-convergence.py
