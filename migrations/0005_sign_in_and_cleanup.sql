-- Sign-in codes: several can wait for one email at the same time. Before, asking for a new code cancelled the
-- earlier one, so a member whose first email was slow typed a code that no longer worked (about one try in
-- eight failed, 20-21 Nov 2026). The old login_codes table is left in place and no longer used.
create table login_tokens (
  id integer primary key autoincrement,
  email text not null,
  code_hash text not null,
  link_hash text not null,
  tries integer not null default 0,
  expires_at text not null
);
create index login_tokens_email_idx on login_tokens (email, expires_at);
insert into login_tokens (email, code_hash, link_hash, tries, expires_at)
  select email, code_hash, link_hash, tries, expires_at from login_codes where expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- The daily clean-up looks for the oldest clips.
create index clips_created_idx on clips (created_at);
