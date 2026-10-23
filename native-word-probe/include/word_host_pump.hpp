#pragma once

// Wake the loaded global template only when native work becomes ready. Word's
// Application.OnTime is a single shared timer and can be replaced by add-ins.
void EquationLabInstallWordHostPump();
void EquationLabWakeWordHost();
void EquationLabWordHostDidPoll();
