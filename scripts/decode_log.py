import sys
data = open('D:/coding/ai_line_work/codex_review2.log', 'rb').read()
text = data.decode('utf-16-le')
# Print last 10000 chars
print(text[-10000:])
