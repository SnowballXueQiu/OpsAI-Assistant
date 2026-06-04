#include <arpa/inet.h>
#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <fstream>
#include <iostream>
#include <map>
#include <netdb.h>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string>
#include <sys/socket.h>
#include <sys/statvfs.h>
#include <sys/time.h>
#include <sys/utsname.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>

using Clock = std::chrono::steady_clock;

struct Config {
    std::string serverUrl = "http://127.0.0.1:3000/api/metrics";
    int intervalSeconds = 5;
    std::string hostname;
    std::vector<std::string> logFiles{"/var/log/syslog", "/var/log/auth.log"};
};

struct CpuTimes {
    unsigned long long idle = 0;
    unsigned long long total = 0;
};

struct ProcessInfo {
    int pid = 0;
    std::string name;
    unsigned long long vmRssKb = 0;
};

struct LoadAverage {
    double one = 0;
    double five = 0;
    double fifteen = 0;
};

struct Url {
    std::string host;
    std::string path;
    int port = 80;
};

struct HttpResult {
    bool ok = false;
    int statusCode = 0;
    std::string message;
    std::string body;
};

static std::string trim(const std::string& value) {
    const auto begin = value.find_first_not_of(" \t\r\n");
    if (begin == std::string::npos) return "";
    const auto end = value.find_last_not_of(" \t\r\n");
    return value.substr(begin, end - begin + 1);
}

static std::vector<std::string> split(const std::string& value, char sep) {
    std::vector<std::string> parts;
    std::stringstream ss(value);
    std::string item;
    while (std::getline(ss, item, sep)) {
        item = trim(item);
        if (!item.empty()) parts.push_back(item);
    }
    return parts;
}

static bool isNumeric(const std::string& value) {
    return !value.empty() && std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return std::isdigit(ch);
    });
}

static Config loadConfig(const std::string& path) {
    Config config;
    std::ifstream file(path);
    if (!file.good()) return config;

    std::string line;
    while (std::getline(file, line)) {
        line = trim(line);
        if (line.empty() || line[0] == '#') continue;
        const auto pos = line.find('=');
        if (pos == std::string::npos) continue;
        const auto key = trim(line.substr(0, pos));
        const auto value = trim(line.substr(pos + 1));
        if (key == "server_url") config.serverUrl = value;
        if (key == "interval_seconds") config.intervalSeconds = std::max(1, std::stoi(value));
        if (key == "hostname") config.hostname = value;
        if (key == "log_files") config.logFiles = split(value, ',');
    }
    return config;
}

static double readUptimeSeconds() {
    std::ifstream file("/proc/uptime");
    double uptime = 0;
    file >> uptime;
    return uptime;
}

static LoadAverage readLoadAverage() {
    std::ifstream file("/proc/loadavg");
    LoadAverage load;
    file >> load.one >> load.five >> load.fifteen;
    return load;
}

static std::string detectHostname() {
    struct utsname info {};
    if (uname(&info) == 0) return info.nodename;
    char buffer[256] {};
    if (gethostname(buffer, sizeof(buffer)) == 0) return buffer;
    return "unknown-linux-host";
}

static ProcessInfo readProcessStatus(const std::string& pidText) {
    ProcessInfo info;
    info.pid = std::stoi(pidText);
    std::ifstream file("/proc/" + pidText + "/status");
    std::string line;
    while (std::getline(file, line)) {
        const auto pos = line.find(':');
        if (pos == std::string::npos) continue;
        const auto key = line.substr(0, pos);
        const auto value = trim(line.substr(pos + 1));
        if (key == "Name") info.name = value;
        if (key == "VmRSS") {
            std::stringstream ss(value);
            ss >> info.vmRssKb;
        }
    }
    return info;
}

static std::vector<ProcessInfo> readTopMemoryProcesses(size_t limit) {
    std::vector<ProcessInfo> processes;
    DIR* proc = opendir("/proc");
    if (!proc) return processes;

    while (auto* entry = readdir(proc)) {
        const std::string name = entry->d_name;
        if (!isNumeric(name)) continue;
        ProcessInfo info = readProcessStatus(name);
        if (!info.name.empty() && info.vmRssKb > 0) processes.push_back(info);
    }
    closedir(proc);

    std::sort(processes.begin(), processes.end(), [](const ProcessInfo& a, const ProcessInfo& b) {
        return a.vmRssKb > b.vmRssKb;
    });
    if (processes.size() > limit) processes.resize(limit);
    return processes;
}

static CpuTimes readCpuTimes() {
    std::ifstream file("/proc/stat");
    std::string cpu;
    unsigned long long user = 0, nice = 0, system = 0, idle = 0, iowait = 0;
    unsigned long long irq = 0, softirq = 0, steal = 0;
    file >> cpu >> user >> nice >> system >> idle >> iowait >> irq >> softirq >> steal;
    CpuTimes result;
    result.idle = idle + iowait;
    result.total = user + nice + system + idle + iowait + irq + softirq + steal;
    return result;
}

static double cpuUsagePercent(const CpuTimes& previous, const CpuTimes& current) {
    const auto totalDelta = current.total - previous.total;
    const auto idleDelta = current.idle - previous.idle;
    if (totalDelta == 0) return 0.0;
    return (1.0 - static_cast<double>(idleDelta) / static_cast<double>(totalDelta)) * 100.0;
}

static std::map<std::string, unsigned long long> readMemInfo() {
    std::ifstream file("/proc/meminfo");
    std::map<std::string, unsigned long long> values;
    std::string key;
    unsigned long long value = 0;
    std::string unit;
    while (file >> key >> value >> unit) {
        if (!key.empty() && key.back() == ':') key.pop_back();
        values[key] = value;
    }
    return values;
}

static std::string readLastLines(const std::string& path, int maxLines) {
    std::ifstream file(path);
    if (!file.good()) return "";
    std::vector<std::string> lines;
    std::string line;
    while (std::getline(file, line)) {
        if (line.find("sshd") != std::string::npos ||
            line.find("error") != std::string::npos ||
            line.find("failed") != std::string::npos ||
            line.find("Failed") != std::string::npos ||
            line.find("sudo") != std::string::npos) {
            lines.push_back(line);
            if (lines.size() > static_cast<size_t>(maxLines)) lines.erase(lines.begin());
        }
    }
    std::ostringstream out;
    for (const auto& item : lines) out << item << "\\n";
    return out.str();
}

static std::string jsonEscape(const std::string& text) {
    std::ostringstream out;
    for (unsigned char ch : text) {
        switch (ch) {
            case '\\': out << "\\\\"; break;
            case '"': out << "\\\""; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (ch < 0x20 || ch > 0x7e) {
                    out << "\\u"
                        << std::hex << std::setw(4) << std::setfill('0')
                        << static_cast<int>(ch)
                        << std::dec << std::setfill(' ');
                } else {
                    out << static_cast<char>(ch);
                }
        }
    }
    return out.str();
}

static std::string jsonUnescape(const std::string& text) {
    std::ostringstream out;
    for (size_t i = 0; i < text.size(); ++i) {
        if (text[i] != '\\' || i + 1 >= text.size()) {
            out << text[i];
            continue;
        }
        const char next = text[++i];
        switch (next) {
            case '\\': out << '\\'; break;
            case '"': out << '"'; break;
            case 'n': out << '\n'; break;
            case 'r': out << '\r'; break;
            case 't': out << '\t'; break;
            default: out << next;
        }
    }
    return out.str();
}

static Url parseUrl(const std::string& raw) {
    const std::string prefix = "http://";
    if (raw.rfind(prefix, 0) != 0) throw std::runtime_error("only http:// URLs are supported");
    auto rest = raw.substr(prefix.size());
    auto slash = rest.find('/');
    auto authority = slash == std::string::npos ? rest : rest.substr(0, slash);
    Url url;
    url.path = slash == std::string::npos ? "/" : rest.substr(slash);
    auto colon = authority.find(':');
    if (colon == std::string::npos) {
        url.host = authority;
    } else {
        url.host = authority.substr(0, colon);
        url.port = std::stoi(authority.substr(colon + 1));
    }
    return url;
}

static HttpResult postJson(const std::string& rawUrl, const std::string& body) {
    Url url = parseUrl(rawUrl);
    struct addrinfo hints {};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;

    struct addrinfo* result = nullptr;
    const auto port = std::to_string(url.port);
    if (getaddrinfo(url.host.c_str(), port.c_str(), &hints, &result) != 0) {
        return {false, 0, "getaddrinfo failed", ""};
    }

    int sock = -1;
    for (auto* item = result; item != nullptr; item = item->ai_next) {
        sock = socket(item->ai_family, item->ai_socktype, item->ai_protocol);
        if (sock < 0) continue;
        if (connect(sock, item->ai_addr, item->ai_addrlen) == 0) break;
        close(sock);
        sock = -1;
    }
    freeaddrinfo(result);
    if (sock < 0) return {false, 0, "connect failed", ""};

    timeval timeout {};
    timeout.tv_sec = 8;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));

    std::ostringstream request;
    request << "POST " << url.path << " HTTP/1.1\r\n"
            << "Host: " << url.host << ":" << url.port << "\r\n"
            << "User-Agent: opsai-probe/1.0\r\n"
            << "Accept: application/json\r\n"
            << "Accept-Language: zh-CN,en;q=0.8\r\n"
            << "Content-Type: application/json\r\n"
            << "Content-Length: " << body.size() << "\r\n"
            << "Connection: close\r\n\r\n"
            << body;
    const auto payload = request.str();
    size_t totalSent = 0;
    while (totalSent < payload.size()) {
        const auto sent = send(sock, payload.data() + totalSent, payload.size() - totalSent, 0);
        if (sent <= 0) {
            close(sock);
            return {false, 0, "send failed", ""};
        }
        totalSent += static_cast<size_t>(sent);
    }
    std::string response;
    char buffer[2048];
    while (true) {
        const auto count = recv(sock, buffer, sizeof(buffer), 0);
        if (count <= 0) break;
        response.append(buffer, static_cast<size_t>(count));
    }
    close(sock);

    std::istringstream stream(response);
    std::string httpVersion;
    int statusCode = 0;
    stream >> httpVersion >> statusCode;
    const bool ok = statusCode >= 200 && statusCode < 300;
    if (response.empty()) return {false, 0, "empty response", ""};
    const auto bodyStart = response.find("\r\n\r\n");
    const auto responseBody = bodyStart == std::string::npos ? "" : response.substr(bodyStart + 4);
    return {ok, statusCode, ok ? "posted" : response.substr(0, 160), responseBody};
}

static std::string taskBaseUrl(const std::string& metricsUrl) {
    const std::string suffix = "/metrics";
    if (metricsUrl.size() >= suffix.size() &&
        metricsUrl.substr(metricsUrl.size() - suffix.size()) == suffix) {
        return metricsUrl.substr(0, metricsUrl.size() - suffix.size()) + "/probe/tasks";
    }
    return metricsUrl + "/probe/tasks";
}

static std::string extractJsonString(const std::string& json, const std::string& key) {
    const auto pattern = "\"" + key + "\":\"";
    auto start = json.find(pattern);
    if (start == std::string::npos) return "";
    start += pattern.size();
    std::string value;
    bool escaped = false;
    for (size_t i = start; i < json.size(); ++i) {
        const char ch = json[i];
        if (escaped) {
            value.push_back('\\');
            value.push_back(ch);
            escaped = false;
            continue;
        }
        if (ch == '\\') {
            escaped = true;
            continue;
        }
        if (ch == '"') break;
        value.push_back(ch);
    }
    return jsonUnescape(value);
}

static bool isAllowedDiagnosticCommand(const std::string& command) {
    static const std::vector<std::string> allowed{
        "top -b -n 1 | head -20",
        "ps aux --sort=-%cpu | head -10",
        "uptime",
        "vmstat 1 3",
        "iostat -dx 1 2",
        "journalctl -p warning..alert --since '10 minutes ago' -n 30 --no-pager",
        "journalctl -u ssh --since '30 minutes ago' -n 30 --no-pager",
        "opsai:pressure:cpu:start",
        "opsai:pressure:cpu:stop",
        "opsai:pressure:memory:start",
        "opsai:pressure:memory:stop",
        "opsai:pressure:disk:start",
        "opsai:pressure:disk:stop"
    };
    return std::find(allowed.begin(), allowed.end(), command) != allowed.end();
}

static std::string shellQuote(const std::string& command) {
    std::ostringstream out;
    out << "'";
    for (char ch : command) {
        if (ch == '\'') out << "'\\''";
        else out << ch;
    }
    out << "'";
    return out.str();
}

static std::string pressureShellCommand(const std::string& command) {
    if (command == "opsai:pressure:cpu:start") {
        return R"(PID_FILE=/tmp/opsai-cpu-pressure.pids
if [ -s "$PID_FILE" ] && xargs kill -0 < "$PID_FILE" 2>/dev/null; then
  echo "cpu pressure already running"
  cat "$PID_FILE"
  exit 0
fi
: > "$PID_FILE"
COUNT=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)
i=0
while [ "$i" -lt "$COUNT" ]; do
  sh -c 'while :; do :; done' >/dev/null 2>&1 &
  echo $! >> "$PID_FILE"
  i=$((i + 1))
done
echo "cpu pressure started with ${COUNT} workers"
cat "$PID_FILE")";
    }

    if (command == "opsai:pressure:cpu:stop") {
        return R"(PID_FILE=/tmp/opsai-cpu-pressure.pids
if [ ! -s "$PID_FILE" ]; then
  echo "cpu pressure not running"
  exit 0
fi
xargs kill < "$PID_FILE" 2>/dev/null || true
rm -f "$PID_FILE"
echo "cpu pressure stopped")";
    }

    if (command == "opsai:pressure:memory:start") {
        return R"SH(PID_FILE=/tmp/opsai-memory-pressure.pid
if [ -s "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "memory pressure already running"
  cat "$PID_FILE"
  exit 0
fi
nohup python3 -c 'import os,time
chunks=[]
target_mb=2200
chunk_mb=64
for _ in range(target_mb//chunk_mb):
    block=bytearray(chunk_mb*1024*1024)
    for i in range(0,len(block),4096):
        block[i]=1
    chunks.append(block)
    time.sleep(0.03)
print(f"memory pressure allocated {len(chunks)*chunk_mb}MB pid={os.getpid()}", flush=True)
while True:
    time.sleep(10)
' >/tmp/opsai-memory-pressure.log 2>&1 &
echo $! > "$PID_FILE"
echo "memory pressure started"
cat "$PID_FILE")SH";
    }

    if (command == "opsai:pressure:memory:stop") {
        return R"SH(PID_FILE=/tmp/opsai-memory-pressure.pid
if [ ! -s "$PID_FILE" ]; then
  echo "memory pressure not running"
  exit 0
fi
kill "$(cat "$PID_FILE")" 2>/dev/null || true
rm -f "$PID_FILE"
echo "memory pressure stopped")SH";
    }

    if (command == "opsai:pressure:disk:start") {
        return R"(TARGET=/var/tmp/opsai-disk-pressure.bin
rm -f /tmp/opsai-disk-pressure.bin
if [ -f "$TARGET" ]; then
  echo "disk pressure already running"
  ls -lh "$TARGET"
  df -h /var/tmp
  exit 0
fi
if command -v fallocate >/dev/null 2>&1 && fallocate -l 4G "$TARGET"; then
  :
else
  rm -f "$TARGET"
  dd if=/dev/zero of="$TARGET" bs=1M count=4096 status=none
fi
sync
echo "disk pressure started with 4G file"
ls -lh "$TARGET"
df -h /var/tmp)";
    }

    if (command == "opsai:pressure:disk:stop") {
        return R"(TARGET=/var/tmp/opsai-disk-pressure.bin
rm -f /tmp/opsai-disk-pressure.bin
if [ ! -f "$TARGET" ]; then
  echo "disk pressure not running"
  df -h /var/tmp
  exit 0
fi
rm -f "$TARGET"
sync
echo "disk pressure stopped"
df -h /var/tmp)";
    }

    return command;
}

static std::string runCommand(const std::string& command, int& exitCode) {
    exitCode = 0;
    if (!isAllowedDiagnosticCommand(command)) {
        exitCode = 126;
        return "command rejected by probe whitelist";
    }

    std::string output;
    const auto executable = command.rfind("opsai:pressure:", 0) == 0
        ? "sh -c " + shellQuote(pressureShellCommand(command))
        : command;
    FILE* pipe = popen((executable + " 2>&1").c_str(), "r");
    if (!pipe) {
        exitCode = 127;
        return "popen failed";
    }

    char buffer[512];
    while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
        output += buffer;
        if (output.size() > 12000) {
            output += "\n[output truncated]\n";
            break;
        }
    }
    const int status = pclose(pipe);
    exitCode = WIFEXITED(status) ? WEXITSTATUS(status) : status;
    return output;
}

static void pollAndRunTask(const Config& config) {
    const auto baseUrl = taskBaseUrl(config.serverUrl);
    const auto nextBody = "{\"hostname\":\"" + jsonEscape(config.hostname) + "\"}";
    const auto next = postJson(baseUrl + "/next", nextBody);
    if (!next.ok || next.body.find("\"task\":null") != std::string::npos) return;

    const auto id = extractJsonString(next.body, "id");
    const auto command = extractJsonString(next.body, "command");
    if (id.empty() || command.empty()) return;

    int exitCode = 0;
    const auto output = runCommand(command, exitCode);
    std::ostringstream result;
    result << "{"
           << "\"id\":\"" << jsonEscape(id) << "\","
           << "\"hostname\":\"" << jsonEscape(config.hostname) << "\","
           << "\"exitCode\":" << exitCode << ","
           << "\"output\":\"" << jsonEscape(output) << "\""
           << "}";
    const auto posted = postJson(baseUrl + "/result", result.str());
    std::cout << (posted.ok ? "task-result " : "task-result-failed ")
              << id << " status=" << posted.statusCode << "\n";
    std::cout.flush();
}

static std::string buildPayload(const Config& config, double cpuPercent) {
    auto mem = readMemInfo();
    const auto load = readLoadAverage();
    const auto uptime = readUptimeSeconds();
    const auto processes = readTopMemoryProcesses(5);
    const auto memTotal = mem["MemTotal"];
    const auto memAvailable = mem["MemAvailable"];
    const auto memFree = mem["MemFree"];
    const auto memUsed = memTotal > memAvailable ? memTotal - memAvailable : 0;

    struct statvfs disk {};
    unsigned long long diskTotal = 0;
    unsigned long long diskAvailable = 0;
    unsigned long long diskFree = 0;
    if (statvfs("/", &disk) == 0) {
        diskTotal = static_cast<unsigned long long>(disk.f_blocks) * disk.f_frsize;
        diskAvailable = static_cast<unsigned long long>(disk.f_bavail) * disk.f_frsize;
        diskFree = static_cast<unsigned long long>(disk.f_bfree) * disk.f_frsize;
    }

    std::ostringstream logs;
    for (const auto& path : config.logFiles) {
        const auto content = readLastLines(path, 12);
        if (!content.empty()) logs << "== " << path << " ==\\n" << content;
    }

    std::ostringstream json;
    json << "{"
         << "\"hostname\":\"" << jsonEscape(config.hostname) << "\","
         << "\"sentAt\":\"" << std::chrono::duration_cast<std::chrono::seconds>(
                std::chrono::system_clock::now().time_since_epoch()).count() << "\","
         << "\"system\":{\"uptimeSeconds\":" << uptime
         << ",\"loadAverage\":{\"one\":" << load.one
         << ",\"five\":" << load.five
         << ",\"fifteen\":" << load.fifteen << "}},"
         << "\"cpu\":{\"usagePercent\":" << cpuPercent << "},"
         << "\"memory\":{\"totalKb\":" << memTotal << ",\"usedKb\":" << memUsed
         << ",\"freeKb\":" << memFree
         << ",\"availableKb\":" << memAvailable << "},"
         << "\"disk\":{\"mount\":\"/\",\"totalBytes\":" << diskTotal
         << ",\"freeBytes\":" << diskFree
         << ",\"availableBytes\":" << diskAvailable << "},"
         << "\"processes\":[";
    for (size_t i = 0; i < processes.size(); ++i) {
        if (i > 0) json << ",";
        json << "{\"pid\":" << processes[i].pid
             << ",\"name\":\"" << jsonEscape(processes[i].name) << "\""
             << ",\"memoryKb\":" << processes[i].vmRssKb << "}";
    }
    json << "],"
         << "\"logs\":\"" << jsonEscape(logs.str()) << "\""
         << "}";
    return json.str();
}

int main(int argc, char** argv) {
    const std::string configPath = argc > 1 ? argv[1] : "/etc/opsai/probe.conf";
    Config config = loadConfig(configPath);
    if (config.hostname.empty()) config.hostname = detectHostname();

    std::cout << "opsai-probe started, target=" << config.serverUrl
              << ", interval=" << config.intervalSeconds << "s\n";

    CpuTimes previous = readCpuTimes();
    std::this_thread::sleep_for(std::chrono::seconds(1));

    while (true) {
        CpuTimes current = readCpuTimes();
        const auto cpu = cpuUsagePercent(previous, current);
        previous = current;
        const auto body = buildPayload(config, cpu);
        const auto result = postJson(config.serverUrl, body);
        std::cout << (result.ok ? "posted " : "failed ")
                  << body.size() << " bytes, status=" << result.statusCode
                  << ", message=" << result.message << "\n";
        std::cout.flush();
        pollAndRunTask(config);
        std::this_thread::sleep_for(std::chrono::seconds(config.intervalSeconds));
    }
}
