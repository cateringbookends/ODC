import re
import sqlite3
import time


def slug(value):
    base = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-") or "unassigned"
    return f"post-{base}"


con = sqlite3.connect("odc.db")
con.row_factory = sqlite3.Row
cur = con.cursor()

stamp = str(int(time.time()))
cur.execute(f"create table if not exists master_heads_backup_{stamp} as select * from master_heads")
cur.execute(f"create table if not exists master_persons_backup_{stamp} as select * from master_persons")

rows = cur.execute(
    """
    select
      h.name as old_head,
      p.person_name,
      p.person_code,
      p.person_designation,
      p.person_department,
      p.person_location
    from master_persons p
    join master_heads h on h.id = p.head_id
    order by h.sort_order, p.sort_order, p.id
    """
).fetchall()

by_post = {}
for row in rows:
    post = (row["person_designation"] or "").strip() or "Unassigned"
    department = (row["person_department"] or "").strip() or (row["old_head"] or "").strip()
    by_post.setdefault(post, []).append(
        {
            "name": (row["person_name"] or "").strip(),
            "code": (row["person_code"] or "").strip(),
            "designation": post,
            "department": department,
            "location": (row["person_location"] or "").strip(),
        }
    )

posts = sorted(by_post, key=lambda post: (0 if re.search(r"\bhead\b", post, re.I) else 1, post.lower()))

cur.execute("delete from master_persons")
cur.execute("delete from master_heads")

used_ids = set()
for head_index, post in enumerate(posts):
    head_id = slug(post)
    original_id = head_id
    suffix = 2
    while head_id in used_ids:
        head_id = f"{original_id}-{suffix}"
        suffix += 1
    used_ids.add(head_id)

    cur.execute("insert into master_heads (id, name, sort_order) values (?, ?, ?)", (head_id, post, head_index))

    people = sorted(by_post[post], key=lambda person: person["name"].lower())
    for person_index, person in enumerate(people):
        cur.execute(
            """
            insert into master_persons
              (head_id, person_name, sort_order, person_code, person_designation, person_department, person_location)
            values (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                head_id,
                person["name"],
                person_index,
                person["code"],
                person["designation"],
                person["department"],
                person["location"],
            ),
        )

con.commit()

print("regrouped_people", len(rows))
print("post_groups", len(posts))
print("backup_stamp", stamp)
print("first_groups")
for post in posts[:20]:
    print(post, len(by_post[post]))
