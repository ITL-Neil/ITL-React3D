import struct, json

# Minimal valid GLB with empty glTF
glTF = {"asset": {"version": "2.0"}}
json_bytes = json.dumps(glTF).encode("utf-8")
# pad to 4-byte alignment
pad = (4 - len(json_bytes) % 4) % 4
json_bytes += b' ' * pad

# Header: magic, version, total length
total_len = 12 + 8 + len(json_bytes)
header = struct.pack('<4sII', b'glTF', 2, total_len)

# JSON chunk
chunk = struct.pack('<I', len(json_bytes)) + b'\x00' + json_bytes

with open("test_minimal.glb", "wb") as f:
    f.write(header + chunk)
print("Created test_minimal.glb")
