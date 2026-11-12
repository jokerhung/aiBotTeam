"""Seed a long transcript straight into the database of a running server: python seed_long.py <messages.db> <bot_id> <thread_id> <count>"""
import json
import sqlite3
import sys
import time

db, bot, thread, count = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
con = sqlite3.connect(db, timeout=30)
parent, now = None, int(time.time() * 1000) - count * 1000
for i in range(count):
    mine = i % 2 == 0
    body = {"id": f"seed{i:05d}", "role": "user" if mine else "bot", "kind": "text", "author": bot, "at": now + i * 1000,
            "text": f"Message {i}. " + ("A longer line with `code`, **bold** and a list:\n- one\n- two\n" if i % 7 == 0 else "Some words to wrap across the line. " * 3)}
    con.execute("INSERT OR REPLACE INTO messages(id,bot_id,thread_id,parent_id,role,at,seq,body) VALUES(?,?,?,?,?,?,?,?)",
                (body["id"], bot, thread, parent, body["role"], body["at"], i + 1, json.dumps(body)))
    parent = body["id"]
con.execute("UPDATE threads SET leaf_id=? WHERE id=?", (parent, thread))
con.commit()
con.close()
print("seeded", count)
