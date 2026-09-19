# Working notes for this repo

## Output conventions

**Keep comments out of copy-paste blocks.** Commands in a code block should be clean enough to
select-all and paste — no inline `#` comments, no explanatory text above a command *inside* the
fence. Put the explanation in prose before or after the block, or in a table beside it.

Do this:

> Run the Cloudinary and FORGE checks:
> ```bash
> ./hunt.sh
> ```
> Add a key to also resolve the Shorts:
> ```bash
> YT_API_KEY=AIza... ./hunt.sh
> ```

Not this:

> ```bash
> ./hunt.sh                      # Cloudinary + FORGE checks
> YT_API_KEY=AIza... ./hunt.sh   # also resolves the Shorts
> ```

One command per block where the commands are alternatives rather than a sequence.

Comments inside committed script files are fine — that's source, not something to paste.

## Where files land

Files sent to the user arrive in their **Downloads** folder. Write commands that assume that —
lead with `cd ~/Downloads` (in the same block, as part of the sequence) rather than leaving the
path for them to work out.
