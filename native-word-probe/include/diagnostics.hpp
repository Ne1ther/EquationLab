#pragma once
#include <cstdint>
namespace bridge_probe {
// Counts/HRESULTs only: no equation bytes, strings, ticket, path or pointers.
// Gauges describe the last object touched; counters are process-wide.
enum class Metric : std::uint32_t {
    SetClientSiteCalls=1,ClientPresent,SaveObjectCalls,SaveObjectResult,
    PersistSaveCalls,PersistSaveResult,SaveCompletedCalls,SaveCompletedResult,
    Dirty,NoScribble,DataSinks,OleSinks,ViewSink,ApplyCalls,ApplyResult,
    PreviewCalls,PreviewResult,DataNotifications,ViewNotifications,CloseCalls,
    CloseMode,LoadCalls,LoadResult,SourceStorage,DAdviseRejected,DAdviseResult,
    DAdviseFormat,DAdviseAspect,RunnableQueries,SnapshotResult,SnapshotCalls,
    SaveNotifications,CloseNotifications,EditGeneration,SameAsLoad,
    SaveObjectWithoutPersistSave,DoVerbCalls,DoVerbResult,CancelCalls,CancelResult,
    SaveCompletedWithoutSave,DrawCalls,DrawResult,DrawPdfBytes,DrawMissingPreview,Count
};
std::int32_t diagnosticValue(std::uint32_t);
}
