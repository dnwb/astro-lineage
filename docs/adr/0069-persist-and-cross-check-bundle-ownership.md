# Persist and cross-check bundle ownership

Every bundle file records ownership once in its envelope while nested records inherit it. Work YAML and Markdown use `work_id`; Research Line and Learning Path YAML plus reading frontmatter use `line_id` or `path_id`. Validators require directory ID, YAML ID, and Markdown frontmatter ID to agree, using intentional integrity redundancy without treating paths as domain truth.
