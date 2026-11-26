"""Minimal mDNS responder: answers "<name>.local" with this computer's LAN address, so devices on the
same Wi-Fi (iPad, Mac, iPhone, most Android and Windows machines) can open http://<name>.local.

Standard library only. Answers IPv4 address (A) queries for one name; everything else is ignored.
"""
import socket
import struct
import threading
import time

GROUP, PORT = "224.0.0.251", 5353
TYPE_A, TYPE_ANY, CLASS_IN = 1, 255, 1
TTL = 120


def _encode_name(name):
    out = b""
    for label in name.rstrip(".").split("."):
        raw = label.encode()
        out += bytes([len(raw)]) + raw
    return out + b"\x00"


def _read_name(data, off):
    """Decode a (possibly compressed) DNS name. Returns (name, offset after the name)."""
    labels, end, jumps = [], None, 0
    while True:
        if off >= len(data):
            raise ValueError("truncated name")
        n = data[off]
        if n == 0:
            off += 1
            break
        if n & 0xC0 == 0xC0:  # compression pointer
            if off + 1 >= len(data) or jumps > 10:
                raise ValueError("bad pointer")
            if end is None:
                end = off + 2
            off = ((n & 0x3F) << 8) | data[off + 1]
            jumps += 1
            continue
        labels.append(data[off + 1:off + 1 + n].decode(errors="replace"))
        off += 1 + n
    return ".".join(labels), (end if end is not None else off)


def parse_questions(data):
    """Return [(name, qtype, unicast_requested)] for a query packet, or [] for responses/garbage."""
    if len(data) < 12:
        return []
    _id, flags, qd, _an, _ns, _ar = struct.unpack("!6H", data[:12])
    if flags & 0x8000:  # a response, not a query
        return []
    out, off = [], 12
    for _ in range(qd):
        name, off = _read_name(data, off)
        if off + 4 > len(data):
            break
        qtype, qclass = struct.unpack("!HH", data[off:off + 4])
        off += 4
        out.append((name.lower(), qtype, bool(qclass & 0x8000)))
    return out


def build_answer(name, ip):
    header = struct.pack("!6H", 0, 0x8400, 0, 1, 0, 0)  # id 0, authoritative response, 1 answer
    rr = _encode_name(name) + struct.pack("!HHIH", TYPE_A, CLASS_IN | 0x8000, TTL, 4) + socket.inet_aton(ip)
    return header + rr


class Responder:
    def __init__(self, name, ip):
        self.name = name.lower().rstrip(".")
        if not self.name.endswith(".local"):
            self.name += ".local"
        self.ip = ip
        self.sock = None

    def start(self):
        """Bind and start answering in a background thread. Returns an error string, or None on success."""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if hasattr(socket, "SO_REUSEPORT"):  # macOS/Linux: share 5353 with the OS's own responder
                try:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
                except OSError:
                    pass
            s.bind(("", PORT))
            s.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, socket.inet_aton(GROUP) + socket.inet_aton(self.ip))
            s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(self.ip))
            s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
        except OSError as e:
            return str(e)
        self.sock = s
        threading.Thread(target=self._serve, daemon=True).start()
        threading.Thread(target=self._announce, daemon=True).start()
        return None

    def _send(self, addr):
        try:
            self.sock.sendto(build_answer(self.name, self.ip), addr)
        except OSError:
            pass

    def _announce(self):
        # Unsolicited announcements so devices pick up the name (and any new IP) promptly.
        for delay in (0, 1, 2):
            time.sleep(delay)
            self._send((GROUP, PORT))

    def _serve(self):
        while True:
            try:
                data, addr = self.sock.recvfrom(9000)
                questions = parse_questions(data)
            except (OSError, ValueError, UnicodeError, struct.error):
                continue
            for qname, qtype, unicast in questions:
                if qname == self.name and qtype in (TYPE_A, TYPE_ANY):
                    # One-shot resolvers query from a random port and expect a direct reply.
                    if unicast or addr[1] != PORT:
                        self._send(addr)
                    if addr[1] == PORT:
                        self._send((GROUP, PORT))
                    break
