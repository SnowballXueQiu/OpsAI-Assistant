cmake_minimum_required(VERSION 3.16)
project(opsai_probe LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(opsai-probe src/main.cpp)

install(TARGETS opsai-probe RUNTIME DESTINATION bin)
install(FILES config/probe.conf DESTINATION /etc/opsai)
install(FILES config/opsai-probe.service DESTINATION /lib/systemd/system)

