import os
import shutil
from datetime import datetime


def clear_directory(directory_path):
    """
    Delete the directory if it exists and recreate it as empty.
    """
    if os.path.exists(directory_path):
        # Remove the whole directory tree
        shutil.rmtree(directory_path)
    # Recreate the empty directory
    os.makedirs(directory_path, exist_ok=True)
    print(f"Cleared directory: {directory_path}")


def merge_directory_files(src_directory, output_filename):
    """
    Explore all files under a specified directory and merge them
    into a single text file.

    Args:
        src_directory (str): Path of the source directory to explore
        output_filename (str): Path of the output file
    """
    # Check if src directory exists
    if not os.path.isdir(src_directory):
        print(f"Error: directory '{src_directory}' not found. Skipping.")
        return

    # Ensure output directory exists
    output_dir = os.path.dirname(output_filename)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"Created output directory: {output_dir}")

    print(f"--- Start: merging from '{src_directory}' to '{output_filename}' ---")

    try:
        # Open the output file (UTF-8 write)
        with open(output_filename, 'w', encoding='utf-8') as outfile:
            file_count = 0
            # Walk through the directory tree
            for dirpath, dirnames, filenames in os.walk(src_directory):
                # Sort filenames to keep stable order
                for filename in sorted(filenames):
                    filepath = os.path.join(dirpath, filename)

                    # Skip the output file itself (in case same directory)
                    if os.path.abspath(filepath) == os.path.abspath(output_filename):
                        continue

                    print(f"Processing: {filepath}")
                    file_count += 1

                    # Write file path (relative from current directory)
                    relative_path = os.path.relpath(filepath, start='.')
                    outfile.write(f"{relative_path}\n---\n")

                    # Read file contents and write into output
                    try:
                        with open(filepath, 'r', encoding='utf-8') as infile:
                            content = infile.read()
                            outfile.write(content)
                    except UnicodeDecodeError:
                        outfile.write(
                            f"\n--- Error: file '{relative_path}' "
                            f"cannot be decoded as UTF-8 "
                            f"(maybe a binary file) ---\n"
                        )
                    except Exception as e:
                        outfile.write(
                            f"\n--- Error: cannot read file "
                            f"'{relative_path}': {e} ---\n"
                        )

                    # Separator between files
                    outfile.write("\n---\n\n")

        print(f"Done: merged {file_count} files into '{output_filename}'.\n")

    except Exception as e:
        print(f"Unexpected error: {e}")


def merge_files(src_files, output_filename):
    """
    Merge multiple specific files into a single text file.

    Args:
        src_files (list[str]): List of file paths to merge
        output_filename (str): Path of the output file
    """
    # Ensure output directory exists
    output_dir = os.path.dirname(output_filename)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
        print(f"Created output directory: {output_dir}")

    print(f"--- Start: merging {len(src_files)} files into '{output_filename}' ---")

    try:
        with open(output_filename, 'w', encoding='utf-8') as outfile:
            file_count = 0

            for filepath in src_files:
                # Skip non-existing paths
                if not os.path.isfile(filepath):
                    print(f"Warning: file '{filepath}' not found. Skipping.")
                    continue

                # Skip the output file itself (just in case)
                if os.path.abspath(filepath) == os.path.abspath(output_filename):
                    continue

                print(f"Processing: {filepath}")
                file_count += 1

                # Write file path (relative from current directory)
                relative_path = os.path.relpath(filepath, start='.')
                outfile.write(f"{relative_path}\n---\n")

                # Read file contents and write into output
                try:
                    with open(filepath, 'r', encoding='utf-8') as infile:
                        content = infile.read()
                        outfile.write(content)
                except UnicodeDecodeError:
                    outfile.write(
                        f"\n--- Error: file '{relative_path}' "
                        f"cannot be decoded as UTF-8 "
                        f"(maybe a binary file) ---\n"
                    )
                except Exception as e:
                    outfile.write(
                        f"\n--- Error: cannot read file "
                        f"'{relative_path}': {e} ---\n"
                    )

                # Separator between files
                outfile.write("\n---\n\n")

        print(f"Done: merged {file_count} files into '{output_filename}'.\n")

    except Exception as e:
        print(f"Unexpected error: {e}")


if __name__ == '__main__':
    # 1. Clear ./tmp directory first
    TMP_DIR = './tmp'
    clear_directory(TMP_DIR)

    # 2. Generate timestamp in MMDDhhmmss format
    timestamp = datetime.now().strftime('%m%d%H%M%S')

    # 3. Use timestamp at the front of output filenames (directory-based merge)
    merge_directory_files('./js',    f'./tmp/{timestamp}_js.txt')
    merge_directory_files('./css',   f'./tmp/{timestamp}_css.txt')
    merge_directory_files('./data',  f'./tmp/{timestamp}_data.txt')
    merge_directory_files('./doc',  f'./tmp/{timestamp}_doc.txt')
    merge_directory_files('./tests', f'./tmp/{timestamp}_tests.txt')

    # 4. Merge specific top-level files (e.g., README etc.)
    extra_files = [
        './config.php',
        './entry.php',
        './index.html',
        './index.php',
        './manifest.php',
        './manifest.webmanifest',
        './ogp-card.php',
        './sw.js',
        './sw.php',
    ]
    merge_files(extra_files, f'./tmp/{timestamp}_root_files.txt')
