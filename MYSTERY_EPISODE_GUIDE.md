# Mystery Files - Episode Writing Guide

How to write branching narratives that work correctly no matter what path players take.

## Golden Rules

### 1. Every Scene Must Stand Alone
Never assume the player visited a specific previous scene.

**BAD:**
```
"As Uncle Marcus mentioned earlier, the photo is worth a lot of money."
```

**GOOD:**
```
"You realize the photo might be worth a lot of money."
```

### 2. One Choice = One Unique Outcome (Usually)
If two choices feel meaningfully different, they should lead to different scenes.

**BAD:**
```
Choice A: "Tell everyone the truth" → Scene 9
Choice B: "Keep it secret"         → Scene 9  (same scene!)
```

**GOOD:**
```
Choice A: "Tell everyone the truth" → Scene 9 (public reveal)
Choice B: "Keep it secret"         → Scene 10 (quiet resolution)
```

### 3. Merge Points Must Be Generic
If multiple paths converge to one scene, that scene can't reference any specific path.

**BAD (if reachable from 3 different paths):**
```
"After talking to Marcus and finding the receipt..."
```

**GOOD:**
```
"After investigating, you've gathered enough clues..."
```

### 4. Use Vague Time References
Don't say "earlier" or "when you spoke to X" - the player might not have done that.

**BAD:** "Earlier, Lily told you about her photography project."
**GOOD:** "You've learned that Lily was working on a photography project."

---

## Scene Types

### 1. Introduction Scene
- Sets up the mystery
- Introduces characters and setting
- Always `scene_order = 1`
- Usually `is_decision_point = true` with 2-3 initial investigation paths

### 2. Investigation Scenes
- Player gathers clues
- Can be visited in any order
- Text must work regardless of what player already knows
- Usually `is_decision_point = true`

### 3. Revelation Scenes
- Major plot points are uncovered
- Often lead to accusation choices or more investigation
- `is_decision_point = true`

### 4. Ending Scenes
- `is_ending = true`
- `ending_type = 'good' | 'neutral' | 'bad'`
- `is_decision_point = false` (no choices)
- Different endings for different final choices

---

## Story Structure Template

```
         [1. INTRO]
        /    |    \
       /     |     \
   [2.A]  [2.B]  [2.C]    ← Investigation branches
      \     |     /        (can cross-reference)
       \    |    /
        [3. REVELATION]    ← Merge point (generic text!)
        /    |    \
       /     |     \
[4.END-A] [4.END-B] [4.END-C]  ← Different endings
  good     neutral    bad
```

---

## Database Schema Reference

### mystery_episodes
```sql
- id: UUID
- episode_number: INTEGER (for ordering)
- title: TEXT
- description: TEXT (shown in episode list)
- is_available: BOOLEAN
```

### mystery_scenes
```sql
- id: UUID
- episode_id: UUID (references episode)
- scene_order: INTEGER (for initial scene lookup)
- title: TEXT (optional, shown as header)
- narrative_text: TEXT (the story content)
- is_decision_point: BOOLEAN (true = show choices)
- is_ending: BOOLEAN (true = game over)
- ending_type: 'good' | 'neutral' | 'bad' | NULL
```

### mystery_choices
```sql
- id: UUID
- scene_id: UUID (which scene this choice appears on)
- choice_order: INTEGER (display order)
- choice_text: TEXT (button text)
- next_scene_id: UUID (where this choice leads)
```

---

## Example: Writing a New Episode

### Step 1: Outline the Story
```
Title: "The Vanishing Heirloom"

Setup: A family ring goes missing during a dinner party.

Suspects:
- Cousin Beth (jealous)
- Uncle Roy (in debt)
- The Butler (had access)

Clues:
- Scratches on jewelry box
- Muddy footprints
- Overheard phone call

Endings:
- Good: Find real thief, family united
- Neutral: Wrong accusation, truth comes out
- Bad: Accuse innocent, real thief escapes
```

### Step 2: Map the Branches
```
[1] Ring missing! Who to question first?
 ├─→ [2] Talk to Beth → learns about jealousy
 ├─→ [3] Talk to Roy → learns about debt
 └─→ [4] Check the scene → finds footprints

[2,3,4] all lead to:
[5] Confront with evidence (merge point - GENERIC TEXT)
 ├─→ [6] Accuse Beth → [7] Bad ending
 ├─→ [8] Accuse Roy → [9] Neutral ending
 └─→ [10] Investigate more → [11] Find butler did it → [12] Good ending
```

### Step 3: Write Each Scene

**Scene 5 (merge point) - MUST BE GENERIC:**
```sql
INSERT INTO mystery_scenes (id, episode_id, scene_order, title, narrative_text, is_decision_point)
VALUES (
  'uuid-here',
  'episode-uuid',
  5,
  'Time to Decide',
  'You''ve gathered enough information to form a theory. The ring
  disappeared sometime during dinner. Multiple people had motive
  and opportunity.

  You could make an accusation now, or continue investigating.',
  true
);
```

Notice: NO mention of specific conversations. Works regardless of path.

### Step 4: Create Choices

```sql
INSERT INTO mystery_choices (scene_id, choice_order, choice_text, next_scene_id) VALUES
('scene-5-uuid', 1, 'Accuse Cousin Beth', 'scene-6-uuid'),
('scene-5-uuid', 2, 'Accuse Uncle Roy', 'scene-8-uuid'),
('scene-5-uuid', 3, 'Keep investigating', 'scene-10-uuid');
```

---

## Checklist Before Publishing

- [ ] Every scene works if reached from ANY valid path
- [ ] No scene references "earlier" conversations that might not have happened
- [ ] Each meaningfully different choice leads to a different scene
- [ ] Merge points use generic language
- [ ] All endings match the choices that lead to them
- [ ] Scene 1 is the intro (`scene_order = 1`)
- [ ] All ending scenes have `is_ending = true`
- [ ] All ending scenes have `ending_type` set

---

## Tips for Good Mysteries

1. **3 suspects minimum** - gives meaningful choices
2. **Red herrings** - innocent people with suspicious behavior
3. **Physical clues** - not just conversations
4. **Ticking clock** - adds urgency (dinner in 30 min, guests leaving soon)
5. **Twist** - the obvious suspect isn't guilty
6. **Emotional stakes** - family relationships, not just "find the thief"
7. **Both players matter** - choices they agree on should feel meaningful
