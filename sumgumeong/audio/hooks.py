import os, sys
sys.argv = [sys.argv[0], "/home/user/alcohol/sumgumeong/audio/beats"]
import render_beats as rb
for k, (mel, ch) in rb.HOOKS.items():
    out = rb.hook_layer(k, rb.STYLES[k][2], mel, ch, rb.HOOK_INST.get(k, ("choir_aahs",)))
    rb.save_mp3(out, os.path.join(rb.OUT, f"hook_{k}.mp3"), 112)
