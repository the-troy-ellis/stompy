# Stompy for the Steam Deck. C11, SDL2 and OpenGL 3.3; nothing else.
#   make        the game, build/stompy
#   make test   the headless sim tests, build/test
#   make run    build and run
CC      ?= cc
CFLAGS  ?= -O2 -g
CFLAGS  += -std=c11 -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -Isrc -I. -I.
SDL_CFLAGS := $(shell pkg-config --cflags sdl2 2>/dev/null || sdl2-config --cflags)
SDL_LIBS   := $(shell pkg-config --libs sdl2 2>/dev/null || sdl2-config --libs)
LIBS    = $(SDL_LIBS) -lGL -lm

SIM_SRC  = $(wildcard src/util/*.c) $(wildcard src/data/*.c) $(wildcard src/sim/*.c)
GAME_SRC = $(SIM_SRC) $(wildcard src/platform/*.c) $(wildcard src/render/*.c) $(wildcard src/game/*.c) src/main.c
TEST_SRC = $(SIM_SRC) $(wildcard test/*.c)

SIM_OBJ  = $(SIM_SRC:%.c=build/%.o)
GAME_OBJ = $(GAME_SRC:%.c=build/%.o)
TEST_OBJ = $(TEST_SRC:%.c=build/%.o)

all: build/stompy

build/stompy: $(GAME_OBJ)
	@mkdir -p $(@D)
	$(CC) $(CFLAGS) -o $@ $^ $(LIBS)

build/tests: $(TEST_OBJ)
	@mkdir -p $(@D)
	$(CC) $(CFLAGS) -o $@ $^ -lm

build/%.o: %.c
	@mkdir -p $(@D)
	$(CC) $(CFLAGS) $(SDL_CFLAGS) -MMD -MP -c -o $@ $<

test: build/tests
	./build/tests

run: build/stompy
	./build/stompy

# The sim never touches the platform: no SDL or GL include may appear under src/sim, src/data or src/util.
lint:
	@! grep -rnE '#include *<(SDL|GL)' src/sim src/data src/util || (echo "sim imports the platform" && false)
	@echo lint ok

clean:
	rm -rf build

-include $(GAME_OBJ:.o=.d) $(TEST_OBJ:.o=.d)
.PHONY: all test run lint clean
