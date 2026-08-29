# Crit 5 reflection

**What was the breakthrough that moved the work forward?**

The breakthrough was realising that a spec line I read as a UI constraint ---
no on-screen instructions --- was actually a design constraint in disguise. My
first instinct was to find some clever way to sneak a hint past the letter of
the rule. Instead I let the rule stand and asked what the *game* could teach
with, rather than what the *screen* could say: a blinking caret and a
confirming hop on the first press. The result reads better than the label it
replaced would have. That reframe --- a rule that looks like it's in the way is
sometimes the thing worth building around, not working around --- is the piece
I want to carry into the next prototype before I've spent an hour resisting it.

**What did this work change about who I want to be as a developer?**

It sharpened the gap between what a test can hold and what only playing can.
`spec/game.test.ts` proves the economy's numbers are internally consistent ---
that a token raises the budget, that the budget sets the speed, that the
relationships hold under a sweep of seeds. None of that told me a clean run
just kept accelerating with nothing left to end it; only playing one long
enough did. I used to treat a green suite as the finish line. Now I want to be
the kind of developer who treats it as the floor: the tests tell you the
machine is honest, but only sitting with the thing it produces tells you
whether it's any good. That's a slower habit than shipping on green, and I
think it's the one worth keeping.
