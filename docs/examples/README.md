# Example lists for Schedule & actions

Three files to try the uploads with on the demo project (P1001), in order:

1. `schedule-example.csv`: four new actions, A600 to A630, dated from today.
2. `disciplines-per-action-example.csv`: the disciplines each of them concerns.
3. `document-requirements-example.csv`: the documents each discipline needs. The documents are not in the
   register yet, so each one is registered as a placeholder when the list is read.

Upload them under Schedule & actions, with a PDF of each, as the next revision of the schedule, the disciplines list
and the requirements list. Releasing each revision puts it in force. The schedule file replaces the whole schedule:
actions it does not list are marked removed, so on a project with a schedule add these rows to its own export
instead.

`npm run demo:schedule` fills an empty demo project with a complete example instead.
