# Install the shared Skill

Install Equation Lab on the Mac that will run the Skill. Open **AI → Install or Export Skill… → Install Shared Skill**. The app copies the Skill to `~/.agents/skills/equation-lab` under that Mac account and attaches its local bundled runtime. Equation Lab 0.7.0 uses the label **Install for Codex** for the same location.

| Client | Default user Skill path | Setup |
| --- | --- | --- |
| Codex | `~/.agents/skills/equation-lab` | Reads the shared copy directly. Start a new session and mention `$equation-lab`. |
| Claude Code | `~/.claude/skills/equation-lab` | Choose the **Claude Code** card to link the shared copy. Use `/equation-lab` in a new session. |
| Antigravity / agy | `~/.gemini/config/skills/equation-lab` | Choose the **Antigravity** card to link the shared copy for the app and CLI. Start a new session or run `/skills reload` in agy. |
| DeepSeek Harness | `~/.agents/skills/equation-lab` | Reads the shared copy with the default profile. Use `/equation-lab` or ask to use the Skill by name. |

For a Claude Code profile launched with `CLAUDE_CONFIG_DIR`, use that profile's `skills` directory. For a DeepSeek Harness profile with different roots, add the absolute path of the shared `~/.agents/skills` directory to `customSkillDirs`. If Antigravity does not list the link, use an explicit entry for the Skill in the personal [discovery manifest](https://antigravity.google/docs/customization-discovery?tab=cli#share-customizations-across-projects) or export a physical copy to its Skills directory.

For another client, open **🧠 Other clients** and copy the setup instructions into its chat. If it scans a separate directory, link only the `equation-lab` folder there. For example, to link it to Claude Code manually:

```sh
mkdir -p "$HOME/.claude/skills"
destination="$HOME/.claude/skills/equation-lab"
if [ ! -e "$destination" ] && [ ! -L "$destination" ]; then
    ln -s "$HOME/.agents/skills/equation-lab" "$destination"
fi
```

If the destination already exists, inspect it and keep any separately managed copy. **Export Folder…** under **🧠 Other clients** creates a physical copy for clients that require one. On a new Mac, prefer installing from that Mac's Equation Lab so it can create any client links and bind its runtime there. An exported Skill can also find Equation Lab in `/Applications` or `~/Applications` on the receiving Mac.
