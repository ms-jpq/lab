#!/usr/bin/env -S -- pwsh -NoProfile -NonInteractive

Set-StrictMode -Version 'Latest'

Set-PSReadLineOption -EditMode 'Emacs'
Set-PSReadLineKeyHandler -Key 'Tab' -Function 'MenuComplete'
Set-PSReadLineOption -PredictionViewStyle ListView
Set-PSReadLineOption -MaximumHistoryCount 10000

Set-PSReadLineOption -HistoryNoDuplicates

Set-PSReadLineOption -Colors @{
    ContinuationPrompt     = $PSStyle.Foreground.Yellow
    Default                = $PSStyle.Foreground.Black
    InlinePrediction       = $PSStyle.Foreground.Blue
    ListPredictionSelected = $PSStyle.Foreground.BrightBlack + $PSStyle.Background.Cyan
    ListPredictionTooltip  = $PSStyle.Foreground.BrightBlack
    Member                 = $PSStyle.Foreground.Green
    Number                 = $PSStyle.Foreground.Magenta
    Type                   = $PSStyle.Foreground.BrightBlack
}

$PSStyle.Progress.UseOSCIndicator = $true

Set-PSReadLineOption -TerminateOrphanedConsoleApps
