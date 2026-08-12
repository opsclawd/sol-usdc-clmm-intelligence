import subprocess
with open('full_diff.patch', 'wb') as f:
    f.write(subprocess.check_output(['git', 'diff', 'origin/main...HEAD']))
