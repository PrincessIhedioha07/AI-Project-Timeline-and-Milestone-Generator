import os

def generate_documentation():
    output_file = "Project_Code_Documentation.md"
    project_root = os.getcwd()
    
    # Configuration
    included_extensions = {'.py', '.html', '.css', '.js', '.md'}
    excluded_dirs = {'venv', 'node_modules', '.git', '__pycache__', 'static/vendor'}
    
    with open(output_file, 'w', encoding='utf-8') as doc:
        doc.write("# Project Code Documentation\n\n")
        
        for root, dirs, files in os.walk(project_root):
            # Modify dirs in-place to skip excluded directories
            dirs[:] = [d for d in dirs if d not in excluded_dirs]
            
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in included_extensions and file != output_file:
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, project_root)
                    
                    # Skip the script itself if desired, or include it. 
                    # The user asked for "all my source code", so usually we include the generator too if it matches extensions.
                    # But let's strictly follow "Include only these extensions" which .py is part of.
                    
                    doc.write(f"### {rel_path}\n\n")
                    
                    # Determine language for code block
                    lang = ''
                    if ext == '.py': lang = 'python'
                    elif ext == '.js': lang = 'javascript'
                    elif ext == '.html': lang = 'html'
                    elif ext == '.css': lang = 'css'
                    elif ext == '.md': lang = 'markdown'
                    
                    doc.write(f"```{lang}\n")
                    
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                            doc.write(content)
                    except Exception as e:
                        doc.write(f"Error reading file: {e}")
                        
                    doc.write("\n```\n\n")
                    
    print(f"Documentation generated at: {os.path.abspath(output_file)}")

if __name__ == "__main__":
    generate_documentation()
