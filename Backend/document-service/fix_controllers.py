import os
import re

def fix_intelligent_chat_controller(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 1. Neutralize limit checks in intelligentFolderChatStream
    # Replace the TokenUsageService.getUserUsageAndPlan block
    content = re.sub(
        r'await TokenUsageService\.getUserUsageAndPlan\(userId, authorizationHeader, \{ accountType: req\.user\?\.account_type \}\)\.catch\(err => \{.*?\}\);',
        '// Token limits disabled for all users',
        content,
        flags=re.DOTALL
    )
    
    # 2. Add detailed error report in catch block
    content = re.sub(
        r'\} catch \(error\) \{\s+console\.error\(\'❌ Streaming error:\', error\);\s+sendError\(\'Failed to process streaming chat\', error\.message\);\s+\}',
        r'} catch (error) {\n    console.error("❌ Streaming error (CRITICAL):", error);\n    sendError(`Streaming failed: ${error.message || "Unknown error"}`, error.stack);\n  }',
        content
    )
    
    # 3. Ensure isFreeUser is false
    content = re.sub(r'const isFreeUser = .*?;', 'const isFreeUser = false;', content)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"✅ Fixed {filepath}")

def fix_file_controller(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # Find the real start of the code at line 5660 or similar
    # And ensure TokenUsageService is required
    # Since the file is huge, let's just make sure those specific incremental calls don't crash
    new_lines = []
    for line in lines:
        if 'TokenUsageService.incrementUsage' in line:
            new_lines.append(line.replace('await TokenUsageService.incrementUsage', '// await TokenUsageService.incrementUsage'))
        elif 'TokenUsageService.enforceLimits' in line:
            new_lines.append(line.replace('TokenUsageService.enforceLimits', '({ allowed: true, message: "Unlimited" }) // TokenUsageService.enforceLimits'))
        else:
            new_lines.append(line)
            
    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f"✅ Fixed {filepath}")

if __name__ == "__main__":
    controller_path = r'c:\Users\ADMIN\jurinex-dev\Backend\document-service\controllers\intelligentFolderChatController.js'
    file_path = r'c:\Users\ADMIN\jurinex-dev\Backend\document-service\controllers\FileController.js'
    
    if os.path.exists(controller_path):
        fix_intelligent_chat_controller(controller_path)
    if os.path.exists(file_path):
        fix_file_controller(file_path)
