.PHONY: config build push up down ps logs logs-nginx logs-django logs-habits validate

TAG ?= latest

config:
	docker compose config

build:
	docker compose build webservice django qwen_worker habits_worker davis_poller nginx

push:
	bash build-and-push.sh $(TAG)

up:
	docker compose up -d

down:
	docker compose down

ps:
	docker compose ps

logs:
	docker compose logs -f

logs-nginx:
	docker compose logs -f nginx

logs-django:
	docker compose logs -f django

logs-habits:
	docker compose logs -f habits_worker

validate:
	bash -n setup.sh
	bash -n build-and-push.sh
	docker compose config
